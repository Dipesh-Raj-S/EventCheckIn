#!/usr/bin/env python3
"""
Concurrency test for the check-in endpoint's duplicate prevention.

Creates an event, registers one attendee (producing one qr_token), then fires
50+ simultaneous POST /api/checkin requests with that SAME qr_token from
concurrent workers.

Expected outcome:
  - Exactly 1 response with status 200 (successful check-in)
  - All other responses are 409 ("Already checked in")
  - CheckIn count for that registration is exactly 1
  - Event.checked_in_count incremented by exactly 1

Running against multiple Flask processes:
  To prove cross-process safety with a real PostgreSQL backend, start two
  gunicorn workers pointed at the same DB:

    # In the Docker container (or locally):
    gunicorn wsgi:app -w 2 -b 0.0.0.0:5000 --preload

  Or run two separate flask processes on different ports:
    flask run --port 5000 &
    flask run --port 5001 &

  Then run this script against a load balancer or one of the ports:
    python test_checkin_concurrency.py --base-url http://localhost:5000

Usage:
    python test_checkin_concurrency.py [--base-url http://localhost:5000] [--workers 50]
"""

import argparse
import asyncio
import sys
import time

import aiohttp


async def register_user(session, base_url, email, password, role="attendee", organizer_code=None):
    body = {"email": email, "password": password, "role": role}
    if organizer_code is not None:
        body["organizer_code"] = organizer_code
    async with session.post(f"{base_url}/api/auth/register", json=body) as resp:
        return await resp.json(), resp.status


async def login_user(session, base_url, email, password):
    async with session.post(f"{base_url}/api/auth/login", json={"email": email, "password": password}) as resp:
        data = await resp.json()
        return data.get("access_token")


async def checkin_request(session, base_url, qr_token, station_id, org_token):
    headers = {"Authorization": f"Bearer {org_token}"}
    async with session.post(
        f"{base_url}/api/checkin",
        json={"qr_token": qr_token, "station_id": station_id},
        headers=headers,
    ) as resp:
        body = await resp.json()
        return resp.status, body


async def main(base_url, num_workers):
    print("=" * 60)
    print("  CONCURRENCY TEST -- Check-In Duplicate Prevention")
    print("=" * 60)
    print(f"  Base URL:     {base_url}")
    print(f"  Workers:      {num_workers}")
    print("=" * 60)
    print()

    connector = aiohttp.TCPConnector(limit=0)
    async with aiohttp.ClientSession(connector=connector) as session:

        # --- Step 1: Create organizer + event ---
        print("[1/5] Setting up organizer + event...")
        ts = int(time.time())
        org_email = f"org_checkin_{ts}@test.com"
        org_password = "testpass123"

        await register_user(
            session, base_url, org_email, org_password,
            role="organizer", organizer_code="1309",
        )
        org_token = await login_user(session, base_url, org_email, org_password)
        if not org_token:
            print("    ERROR: Could not create organizer account")
            return 1

        headers = {"Authorization": f"Bearer {org_token}"}
        async with session.post(
            f"{base_url}/api/events",
            json={"name": f"CheckIn Test Event", "date": "2026-12-31T23:59:00", "capacity": 100},
            headers=headers,
        ) as resp:
            event_data = await resp.json()
            event_id = event_data["event"]["id"]
            print(f"    Created event #{event_id}")

        # --- Step 2: Create one attendee + register ---
        print("\n[2/5] Creating attendee and registering...")
        att_email = f"attendee_checkin_{ts}@test.com"
        att_password = "testpass123"
        await register_user(session, base_url, att_email, att_password, role="attendee")
        att_token = await login_user(session, base_url, att_email, att_password)

        att_headers = {"Authorization": f"Bearer {att_token}"}
        async with session.post(
            f"{base_url}/api/events/{event_id}/register",
            headers=att_headers,
        ) as resp:
            reg_data = await resp.json()
            qr_token = reg_data["registration"]["qr_token"]
            reg_id = reg_data["registration"]["id"]
            print(f"    Registered, qr_token = {qr_token[:16]}...")

        # --- Step 3: Get baseline checked_in_count ---
        print("\n[3/5] Capturing baseline checked_in_count...")
        async with session.get(
            f"{base_url}/api/events/{event_id}",
            headers=headers,
        ) as resp:
            baseline = await resp.json()
            baseline_count = baseline["event"]["checked_in_count"]
            print(f"    Baseline checked_in_count = {baseline_count}")

        # --- Step 4: Fire simultaneous check-in requests ---
        print(f"\n[4/5] Firing {num_workers} simultaneous check-in requests for the SAME qr_token...")
        start_time = time.monotonic()

        tasks = [
            checkin_request(session, base_url, qr_token, f"station-{i}", org_token)
            for i in range(num_workers)
        ]
        results = await asyncio.gather(*tasks)

        elapsed = time.monotonic() - start_time

        status_counts = {}
        for status, body in results:
            status_counts[status] = status_counts.get(status, 0) + 1

        count_200 = status_counts.get(200, 0)
        count_409 = status_counts.get(409, 0)
        count_other = sum(v for k, v in status_counts.items() if k not in (200, 409))

        print(f"    Completed in {elapsed:.2f}s")

        # --- Step 5: Verify final state ---
        print("\n[5/5] Verifying final state...")

        # Check event.checked_in_count
        async with session.get(
            f"{base_url}/api/events/{event_id}",
            headers=headers,
        ) as resp:
            final_event = await resp.json()
            final_checked_in = final_event["event"]["checked_in_count"]

        print()
        print("=" * 60)
        print("  RESULTS")
        print("=" * 60)
        print(f"  200 (checked in):    {count_200:>4}   (expected: 1)")
        print(f"  409 (duplicate):     {count_409:>4}   (expected: {num_workers - 1})")
        if count_other:
            print(f"  Other errors:        {count_other:>4}   !! UNEXPECTED")
        print(f"  ---")
        print(f"  checked_in_count:    {final_checked_in:>4}   (baseline: {baseline_count}, expected: {baseline_count + 1})")
        print("=" * 60)

        # Assertions
        passed = True

        if count_200 != 1:
            print(f"  FAIL: Expected exactly 1 successful check-in, got {count_200}")
            passed = False
        else:
            print(f"  PASS: Exactly 1 check-in succeeded")

        if count_409 != num_workers - 1:
            print(f"  FAIL: Expected {num_workers - 1} rejections, got {count_409}")
            passed = False
        else:
            print(f"  PASS: {count_409} duplicate rejections as expected")

        if final_checked_in != baseline_count + 1:
            print(f"  FAIL: checked_in_count is {final_checked_in}, expected {baseline_count + 1}")
            passed = False
        else:
            print(f"  PASS: checked_in_count incremented by exactly 1")

        if count_other > 0:
            print(f"  FAIL: {count_other} unexpected error responses")
            passed = False

        print()
        if passed:
            print("  ALL CHECKS PASSED -- Check-in is race-safe and duplicate-proof!")
        else:
            print("  SOME CHECKS FAILED -- Review the output above")

        print()
        return 0 if passed else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Concurrency test for check-in duplicate prevention")
    parser.add_argument("--base-url", default="http://localhost:5000", help="API base URL")
    parser.add_argument("--workers", type=int, default=50, help="Number of concurrent check-in attempts")
    args = parser.parse_args()

    exit_code = asyncio.run(main(args.base_url, args.workers))
    sys.exit(exit_code)
