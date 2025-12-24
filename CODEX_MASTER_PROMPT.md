You are Codex acting as a senior product engineer.

Build TowMech: a two-sided Android platform inspired by Uber/Bolt that connects:
- Customers (car owners/drivers)
- Mechanics
- Tow truck service providers

The system consists of:
- Android Customer App
- Android Provider App (Mechanics & Tow Trucks)
- Web Admin & Super Admin Portal
- Node.js Backend API
- MongoDB Database
- Firebase (later) for notifications and OTP

NON-NEGOTIABLE REQUIREMENTS:

1) App identity & UX
- App name: TowMech
- Branding inspired by the South African flag:
  - Green: primary actions
  - Gold: pricing & highlights
  - Blue: informational elements
  - Red: errors & cancellations
- Light mode by default
- Dark mode available ONLY via a visible manual toggle (never automatic)

2) Authentication & roles
- OTP-based authentication (SMS + Email placeholders initially)
- Roles:
  - Customer
  - Mechanic
  - Tow Truck
  - Admin
  - Support
  - Super Admin
- Admins and Super Admins can suspend/unsuspend users
- Suspended users must be blocked from all actions

3) Job lifecycle (STRICT)
- Valid states ONLY:
  REQUESTED → OFFERED → ACCEPTED → IN_PROGRESS → COMPLETED | CANCELLED | FAILED
- Invalid or out-of-order transitions must be rejected
- Once a job is ACCEPTED, it must be LOCKED to that provider
- No other provider may accept or modify a locked job

4) Pricing & control
- All pricing is admin-controlled
- Pricing must be editable without redeploying the app
- Pricing changes must apply to new jobs only

5) Auditing & safety
- Every admin or system-critical action must write to an audit log
- Audit logs must be immutable
- Support users are read-only

6) Backend architecture
- Node.js with Express
- MongoDB with Mongoose
- REST API only
- Clear separation of routes, services, models, middleware
- JWT authentication
- Validation on all inputs

7) Database models (minimum)
- Users (with roles, suspension state)
- Jobs (with lifecycle & locking)
- PricingSettings
- Notifications
- AuditLogs

8) Android apps (Kotlin)
- Customer app:
  - Auth
  - Request mechanic/tow
  - View provider price & ETA
  - Track job status
  - History
  - Support
  - Settings (dark mode toggle)
- Provider app:
  - Auth & KYC placeholder
  - Online/offline toggle
  - Accept/decline jobs
  - Job status updates
  - Earnings & history
  - Support
  - Settings (dark mode toggle)

9) Web Admin portal
- Modules:
  - Customers
  - Mechanics
  - Tow Trucks
  - Admins & Support
  - Pricing & Charges
  - Notifications
  - Reports
  - Audit Logs
- Actions:
  - Approve / reject providers
  - Suspend users
  - Edit pricing
  - Resend OTP
  - Export reports

IMPLEMENTATION RULES:

- Follow instructions step by step
- Do NOT invent features not listed
- Do NOT change repository structure unless explicitly instructed
- Do NOT modify README.md unless instructed
- Prefer clarity, correctness, and safety over speed
