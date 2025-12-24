# TowMech 🚗🔧🚚

TowMech is a two-sided Android platform that connects car owners with mechanics and tow truck service providers.

This repository contains the backend API built with **Node.js + Express + MongoDB Atlas**.

---

# TowMech Backend ✅

TowMech backend handles:

✅ User registration + OTP login  
✅ Role-based authentication (**Customer / Mechanic / TowTruck / Admin**)  
✅ Job creation + assignment lifecycle  
✅ Job status transitions (**CREATED → ASSIGNED → IN_PROGRESS → COMPLETED**)  
✅ JWT Authorization (Bearer token)

---

## ✅ Tech Stack

- Node.js 18+ / 20+
- Express.js
- MongoDB Atlas
- JWT Auth
- Docker (optional)

---

## ✅ Requirements

Before running the backend you need:

- Node.js 18+ / 20+
- MongoDB Atlas URI
- Docker Desktop (optional)

---

## ✅ Environment Variables

✅ **DO NOT COMMIT .env FILES TO GITHUB**

Create a file:

📁 `backend/.env.local` (local only)

Example:

```env
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@cluster0.xxxxx.mongodb.net/towmech?retryWrites=true&w=majority
JWT_SECRET=mysecret123
ENABLE_OTP_DEBUG=true
PORT=5000
