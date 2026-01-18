# Productivity Management API

A backend API for a productivity dashboard built with Node.js, Express, and PostgreSQL.

## Setup Instructions
1. Clone the repository.
2. Create a `.env` file with `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`.
3. Run `npm install` followed by `npm run dev`.

## API Endpoints
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| POST | `/register` | Register a new user |
| POST | `/login` | Login and get Token |
| POST | `/tasks` | Create a new task (Requires Token) |
| GET | `/tasks` | Get all tasks (Supports `?status=Pending`) |
| PUT | `/tasks/:id` | Update a task status |
| DELETE | `/tasks/:id` | Delete a task |
| GET | `/dashboard/stats` | Get productivity analytics |