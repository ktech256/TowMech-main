# TowMech

TowMech is a two-sided Android platform that connects car owners with mechanics and tow truck service providers.

This repository is developed using Codex.

# TowMech Backend ✅

TowMech backend API built with **Node.js + Express + MongoDB (Atlas)**.  
This backend handles:

✅ User registration + OTP Login  
✅ Role-based authentication (Customer, TowTruck, Mechanic, Admin)  
✅ Job creation and lifecycle (Created → Assigned → In Progress → Completed)  
✅ JWT token-based authorization

---

## ✅ Requirements

Before running the backend you need:

- Node.js 18+ / 20+
- MongoDB Atlas connection string
- Docker (optional but recommended)

---

## ✅ Environment Variables

Create a file called `.env.local` inside:

📁 `backend/.env.local`

Example:

```env
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@cluster0.xxxxx.mongodb.net/towmech?retryWrites=true&w=majority
JWT_SECRET=mysecret123
ENABLE_OTP_DEBUG=true
PORT=5000
