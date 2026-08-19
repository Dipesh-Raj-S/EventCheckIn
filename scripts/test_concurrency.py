#!/usr/bin/env python3
"""
Concurrency test for the race-safe registration endpoint.

Creates an event with a small capacity (e.g. 10), then fires 100+
simultaneous registration requests from pre-created attendee accounts.

Expected outcome:
  - Exactly `capacity` 201 responses (successful registrations)
  - The rest are 409 responses (capacity full or already registered)
  - registered_count in the DB never exceeds capacity

Usage:
    python test_concurrency.py [--base-url http://localhost:5000] [--capacity 10] [--workers 50]
"""

import argparse
import asyncio
import sys
import time

import aiohttp


async def register_user(session, base_url, email, password, role="attendee", organizer_code=None):
    """Register a user and return the response."""
    body = {"email": email, "password": password, "role": role}
    if organizer_code is not None:
        body["organizer_code"] = organizer_code
    async with session.post(
        f"{base_url}/api/auth/register",
        json=body,
    ) as resp:
        return await resp.json(), resp.status


async def login_user(session, base_url, email, password):
    """Login a user and return the access token."""
    async with session.post(
        f"{base_url}/api/auth/login",
        json={"email": email, "password": password},
    ) as resp:
        data = await resp.json()
        return data.get("access_token")


async def register_for_event(session, base_url, event_id, token):
    """Attempt to register for an event. Returns (status_code, response_body)."""
    headers = {"Authorization": f"Bearer {token}"}
    async with session.post(
        f"{base_url}/api/events/{event_id}/register",
        headers=headers,
    ) as resp:
        body = await resp.json()
        return resp.status, body


async def get_event(session, base_url, event_id, token):
    """Fetch event details."""
    headers = {"Authorization": f"Bearer {token}"}
    async with session.get(
        f"{base_url}/api/events/{event_id}",
        headers=headers,
    ) as resp:
        return await resp.json()


async def main(base_url, capacity, num_workers):
    print("=" * 60)
    print("  CONCURRENCY TEST — Race-Safe Registration")
    print("=" * 60)
    print(f"  Base URL:     {base_url}")
    print(f"  Capacity:     {capacity}")
    print(f"  Workers:      {num_workers}")
    print("=" * 60)
    print()

    connector = aiohttp.TCPConnector(limit=0)  # no connection limit
    async with aiohttp.ClientSession(connector=connector) as session:

        # --- Step 1: Create an organizer and an event ---
        print("[1/4] Setting up organizer + event...")
        org_email = f"org_test_{int(time.time())}@test.com"
        org_password = "testpass123"

        await register_user(
            session, base_url, org_email, org_password,
            role="organizer", organizer_code="1309",
        )
        org_token = await login_user(session, base_url, org_email, org_password)

        if not org_token:
            print("    ERROR: Could not create organizer account")
            return 1

        # Create event
        headers = {"Authorization": f"Bearer {org_token}"}
        async with session.post(
            f"{base_url}/api/events",
            json={
                "name": f"Concurrency Test Event (cap={capacity})",
                "date": "2026-12-31T23:59:00",
                "capacity": capacity,
            },
            headers=headers,
        ) as resp:
            event_data = await resp.json()
            event_id = event_data["event"]["id"]
            print(f"    Created event #{event_id} with capacity={capacity}")

        # --- Step 2: Create attendee accounts ---
        print(f"\n[2/4] Creating {num_workers} attendee accounts...")
        attendee_tokens = []

        async def create_attendee(i):
            email = f"attendee_{int(time.time())}_{i}@test.com"
            pwd = "testpass123"
            await register_user(session, base_url, email, pwd, role="attendee")
            token = await login_user(session, base_url, email, pwd)
            return token

        tasks = [create_attendee(i) for i in range(num_workers)]
        attendee_tokens = await asyncio.gather(*tasks)
        attendee_tokens = [t for t in attendee_tokens if t]  # filter None
        print(f"    Created {len(attendee_tokens)} attendee accounts")

        if len(attendee_tokens) < num_workers:
            print(f"    WARNING: Only {len(attendee_tokens)}/{num_workers} accounts created")

        # --- Step 3: Fire simultaneous registration requests ---
        print(f"\n[3/4] Firing {len(attendee_tokens)} simultaneous registration requests...")
        start_time = time.monotonic()

        tasks = [
            register_for_event(session, base_url, event_id, token)
            for token in attendee_tokens
        ]
        results = await asyncio.gather(*tasks)

        elapsed = time.monotonic() - start_time

        # Tally results
        status_counts = {}
        for status, body in results:
            status_counts[status] = status_counts.get(status, 0) + 1

        count_201 = status_counts.get(201, 0)
        count_409 = status_counts.get(409, 0)
        count_other = sum(v for k, v in status_counts.items() if k not in (201, 409))

        print(f"    Completed in {elapsed:.2f}s")
        print()

        # --- Step 4: Verify final state ---
        print("[4/4] Verifying final state...")
        event_info = await get_event(session, base_url, event_id, org_token)
        final_registered = event_info["event"]["registered_count"]
        final_capacity = event_info["event"]["capacity"]

        print()
        print("=" * 60)
        print("  RESULTS")
        print("=" * 60)
        print(f"  201 (registered):    {count_201:>4}   (expected: {capacity})")
        print(f"  409 (full/dup):      {count_409:>4}   (expected: {len(attendee_tokens) - capacity})")
        if count_other:
            print(f"  Other errors:        {count_other:>4}   ⚠️  UNEXPECTED")
        print(f"  ---")
        print(f"  registered_count:    {final_registered:>4}   (capacity: {final_capacity})")
        print("=" * 60)

        # Assertions
        passed = True

        if count_201 != capacity:
            print(f"  ❌ FAIL: Expected {capacity} successful registrations, got {count_201}")
            passed = False
        else:
            print(f"  ✅ PASS: Exactly {capacity} registrations succeeded")

        if final_registered > final_capacity:
            print(f"  ❌ FAIL: registered_count ({final_registered}) exceeds capacity ({final_capacity})")
            passed = False
        elif final_registered == capacity:
            print(f"  ✅ PASS: registered_count ({final_registered}) equals capacity ({final_capacity})")
        else:
            print(f"  ❌ FAIL: registered_count ({final_registered}) does not match expected ({capacity})")
            passed = False

        if count_other > 0:
            print(f"  ❌ FAIL: {count_other} unexpected error responses")
            passed = False

        print()
        if passed:
            print("  🎉 ALL CHECKS PASSED — Registration is race-safe!")
        else:
            print("  💥 SOME CHECKS FAILED — Review the output above")

        print()
        return 0 if passed else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Concurrency test for event registration")
    parser.add_argument("--base-url", default="http://localhost:5000", help="API base URL")
    parser.add_argument("--capacity", type=int, default=10, help="Event capacity")
    parser.add_argument("--workers", type=int, default=50, help="Number of concurrent attendees")
    args = parser.parse_args()

    exit_code = asyncio.run(main(args.base_url, args.capacity, args.workers))
    sys.exit(exit_code)
