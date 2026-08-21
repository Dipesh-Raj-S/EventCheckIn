# EventCheckIn

A real-time event check-in system with QR codes, offline-first scanning, and AI-powered insights.

## Tech Stack
- **Backend:** Flask, PostgreSQL, SQLAlchemy, Flask-JWT-Extended, Flask-SocketIO, Flask-Limiter
- **Frontend:** React (Vite), TailwindCSS, html5-qrcode, qrcode.react, Socket.IO client
- **AI & Integrations:** Google Gemini API
- **Infrastructure:** Docker Compose, Redis (for distributed rate limiting)

## Quick Start
The project is completely containerized. You can get the whole system running on a clean machine using Docker.

**Prerequisites:** Docker and Docker Compose installed.

1. **Clone the repository** (if not already done).
2. **Setup Environment Variables:**
   ```bash
   cp .env.example .env
   ```
   **Important:** Open `.env` and fill in `GEMINI_API_KEY`. 
   *Note: If you do not wish to set up a Gemini key, you can leave it blank or invalid. The application will still run perfectly; the AI insights feature will simply fall back to displaying raw backend statistics.*
3. **Start the application:**
   ```bash
   docker-compose up --build
   ```

**Service Ports:**
- Frontend: [http://localhost:3000](http://localhost:3000)
- Backend API: `http://localhost:5000`
- PostgreSQL Database: `5432`
- Redis: `6379`

*Note: Database migrations run automatically on startup via the backend's entrypoint script. No manual DB setup is required.*

## Test Accounts & Getting Started

There is no pre-seeded data, but creating accounts is quick and easy. Note that all accounts must use a valid student email domain: `@vitstudent.ac.in` (this is enforced, but not verified against a real directory, so any made-up address ending in this domain will work).

**To test the system, create two accounts manually via the UI at [http://localhost:3000/register](http://localhost:3000/register):**
1. **Organizer Account:** Select "Organizer" role, select a club, and enter the organizer signup code: **`1309`**.
2. **Attendee Account:** Log out, go back to register, and create an "Attendee" account.

## Walkthrough (Testing Requirements)

Follow this path to see all core requirements in action:

1. **Create Event:** Log in as the Organizer, go to the dashboard, and create an event with a small capacity (e.g., 5).
2. **Register Attendees:** Log out, log in as your Attendee, go to the event page, and register for it. Note the generated QR code on your registrations page.
3. **Live Scan:** Log out, log back in as the Organizer. Open the Scanner page. Scan the attendee's QR code (you can point your phone at the screen or use a webcam). You should see a successful check-in.
4. **Duplicate Prevention:** Scan the exact same QR code again. The system will reject it with an "already checked in" conflict.
5. **Real-time Dashboard:** Open the Event Dashboard in one tab and the Scanner in another. Scan a new attendee (or simulate one) and watch the dashboard counts and recent activity update instantly without refreshing.
6. **Offline Sync:** Use your browser's DevTools (Network tab) to throttle to "Offline". Scan a QR code. It will queue locally. Turn the network back to "Online" and watch the app automatically sync the pending scans to the backend.
7. **AI Insights:** Go to the Event Dashboard and ask the AI insights panel a natural language question (e.g., "How is our turnout looking?").
8. **Export Data:** Click the "Export CSV" button on the Event Dashboard to download a full list of attendees and their check-in timestamps.

## Proof of the Four Hard Requirements

Here is exactly how this repository fulfills the hard technical constraints:

### 1. Duplicate Check-In & Capacity Enforcement
The backend uses ACID-compliant transactional guarantees and atomic database updates to prevent race conditions during both registration (capacity) and check-ins (duplicates). 
- **Proof:** Two concurrency scripts are provided in the `scripts/` folder: `test_concurrency.py` (for registration capacity) and `test_checkin_concurrency.py` (for check-in duplicate prevention).
- **Run the proof:** With the app running via `docker-compose up`, open a terminal and run:
  ```bash
  pip install aiohttp  # if not installed globally
  python scripts/test_checkin_concurrency.py
  ```
  The script registers an attendee, gets their QR token, and then blasts the `POST /api/checkin` endpoint with 50 simultaneous requests. 
  **Expected Output:** You will see exactly 1 request succeed (200 OK) and 49 requests fail (409 Conflict). The database count increments by exactly 1.

### 2. QR Sharing Prevention
- **Proof:** We implemented a one-time use opaque bearer token (`qr_token`) stored in the `Registration` table. Once an attendee is checked in, the system enforces a strict 1:1 mapping. If the attendee shares a screenshot of their QR code to a friend, the scanner will recognize the token has already been consumed and reject the second scan with a 409 Conflict. 

### 3. Offline-First Sync
- **Proof:** The `ScannerPage.jsx` uses `idb-keyval` (IndexedDB) to cache scans locally if the network drops or requests fail. Each scan generates a unique `client_scan_id`. When connectivity is restored, the queued payload is blasted to `POST /api/checkin/sync`. 
- **Conflict Policy:** If two offline stations (Station A and Station B) scan the same QR code at different times while offline, and both sync later, the backend respects the *earliest* `device_scanned_at` timestamp. The first one to sync succeeds; the second one is gracefully caught as an expected constraint violation, marked as a conflict in the sync response, and logged into a separate `CheckInConflict` audit table without crashing the batch sync.

### 4. AI Insights (No Hallucinations)
- **Proof:** Implemented using the `google-genai` SDK in `backend/app/blueprints/insights.py`. The backend first computes hard statistics directly from the database (registered count, checked-in count, capacity) and injects them into a strict system prompt. The AI is instructed to only explain and interpret these provided numbers, never to calculate them itself. 
- **Verification:** You can verify the graceful fallback by changing the `GEMINI_API_KEY` to an invalid string in `.env` and restarting the backend. The panel will cleanly fall back to showing raw JSON stats without crashing.

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Yes | `postgresql://postgres:postgres@db:5432/eventcheckin` |
| `POSTGRES_USER` | DB Init User | Yes | `postgres` |
| `POSTGRES_PASSWORD`| DB Init Password | Yes | `postgres` |
| `POSTGRES_DB` | DB Init Database Name | Yes | `eventcheckin` |
| `FLASK_ENV` | Environment mode | No | `development` |
| `JWT_SECRET_KEY` | Secret for signing JWTs | Yes | `change-me-in-production-use-a-long-random-string` |
| `ORGANIZER_SIGNUP_CODE` | Code required to register as organizer | Yes | `1309` |
| `GEMINI_API_KEY` | Google Gemini AI Key | No | (Empty - falls back to raw stats) |
| `VITE_API_URL` | API base URL for frontend | Yes | `http://localhost:5000` |
| `RATELIMIT_STORAGE_URI`| Redis URL for rate limiting | Yes | `redis://redis:6379/0` |

## Known Limitations

- **First-Use Impersonation:** While the one-time token prevents *multiple* people from entering on the same ticket, it does not prevent someone from stealing a ticket and entering *first*. True identity verification would require checking a student ID card at the door alongside the scan.
- **JWT Storage:** The frontend currently stores JWTs in `localStorage` for simplicity and development speed. In a strict production environment, an `httpOnly` secure cookie would be preferred to mitigate XSS risks, though this adds significant CORS/CSRF complexity.

## Project Structure

```text
.
├── backend/
│   ├── app/
│   │   ├── blueprints/    # API Routes (auth, events, checkin, registrations, insights)
│   │   ├── models.py      # SQLAlchemy DB models
│   │   ├── extensions.py  # Shared Flask extensions (DB, Limiter, SocketIO)
│   │   └── sockets.py     # SocketIO event handlers
│   ├── migrations/        # Alembic DB migrations
│   ├── requirements.txt
│   └── wsgi.py            # Application entrypoint
├── frontend/
│   ├── src/
│   │   ├── components/    # Reusable UI (Navbar, Cards)
│   │   ├── context/       # Auth Context
│   │   └── pages/         # Page Views (Dashboard, Scanner, Events, Auth)
│   ├── vite.config.js
│   └── package.json
├── scripts/               # Concurrency testing and proof scripts
└── docker-compose.yml     # Multi-container orchestration
```
