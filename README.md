# MedFinder Ethiopia (የመድኃኒት አግኚ)

**MedFinder Ethiopia** is a real-time medicine and pharmacy stock radar tailored for the Ethiopian mass market. It eliminates the painful hustle of patients and families walking or taking minibus taxis across Addis Ababa and regional cities to find scarce medications.

It is built with a **Dynamic Policy & Monetization Engine** that allows you to configure launch promotions (e.g. 100% free for the first 3 months), pricing tariffs, paywall cut-off dates, geo-broadcast radii, and feature flags dynamically at runtime without restarting or redeploying code.

---

## 🏗️ Core Architecture & Dynamic Modules

```
medfinder-ethiopia/
├── config/
│   └── default-policy.json             # Baseline JSON system configuration
├── src/
│   ├── config/
│   │   ├── policy.types.ts            # Strongly-typed Zod schemas for all policies
│   │   └── dynamic-config.service.ts  # Runtime hot-reload, validation, & persistence
│   ├── monetization/
│   │   ├── monetization.service.ts    # Evaluates access, free periods, quotas, & paywalls
│   │   ├── telebirr-gateway.service.ts# Telebirr Prepay API & Webhook callback processor
│   │   └── subscription.types.ts      # Subscriptions, Passes, & Invoices
│   ├── matching/
│   │   ├── broadcast-matching.service.ts # Haversine geo-distance, catalog search, & pharmacy ping
│   ├── localization/
│   │   └── template.service.ts        # Dynamic Amharic, Afaan Oromo, & English message interpolation
│   ├── database/
│   │   └── in-memory-db.ts            # Fast database for pharmacies, users, & requests
│   ├── admin/
│   │   └── admin-config.controller.ts # Admin REST endpoints to update policies on the fly
│   ├── test-simulation.ts             # End-to-end verification script
│   └── server.ts                      # Express API server for Telebirr webhooks, search, & bots
```

---

## ⚡ How the Dynamic System Works

### 1. Dynamic Free Period & Monetization
- In `config/default-policy.json`, set `freePromotionUntil`:
  ```json
  "monetization": {
    "globalMode": "HYBRID",
    "freePromotionUntil": "2026-12-31T23:59:59.000Z",
    "freemiumQuotaPerMonth": 2,
    "pricing": {
      "searchFeeETB": 5,
      "monthlyPassETB": 25,
      "threeMonthPassETB": 60
    }
  }
  ```
- **Before the Cutoff Date:** Any user search in Ethiopia is **100% Free** (`reason: 'FREE_PROMOTION_PERIOD'`).
- **On the Cutoff Date:** The system automatically locks the paywall and prompts the user to pay via Telebirr or CBE Birr.
- **Regional Overrides:** You can keep Hawassa or Bahir Dar 100% free while monetizing Bole or Piazza in Addis Ababa.
- **Runtime Cutoff Extension:** The cutoff date can be changed dynamically via API (`POST /api/admin/config/set-free-period`) without downtime.

### 2. Dynamic Geo-Matching & Real-Time Broadcast
- If a drug is in the pre-indexed database, results (distance, price, contact) return immediately.
- If it is rare or unindexed (e.g. *Humulin N*, *Eltroxin*), the system initiates a **Broadcast Ping** to registered pharmacies within `initialRadiusKm` (e.g. 3.5 km).
- Pharmacists respond via Telegram with 1 tap: `[✅ Have Stock (Price: 420 ETB)]` or `[❌ No Stock]`.

### 3. Dynamic Telebirr Checkout
- Seamless integration with Telebirr Prepay API for **5 ETB** (single search) or **25 ETB** (30-day monthly pass).
- Webhook (`POST /api/payment/webhook`) instantly confirms payments and updates the user's active pass.

---

## 🚀 Running the Project

### 1. Run the End-to-End Simulation
To verify the free period, cutoff expiration, Telebirr invoice generation, payment confirmation, and pharmacy ping:
```bash
npm run build
node dist/test-simulation.js
```

### 2. Start the API Server
```bash
npm run build
npm start
```
The server will start at `http://localhost:4000`.

---

## 📡 Key API Endpoints

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/search` | `POST` | Patient drug search (checks dynamic access, searches catalog, or broadcasts) |
| `/api/search/broadcast/:id` | `GET` | Poll or check responses for a broadcast query |
| `/api/pharmacy/respond` | `POST` | Pharmacist confirms stock and price |
| `/api/payment/checkout` | `POST` | Creates Telebirr checkout order with dynamic pricing |
| `/api/payment/webhook` | `POST` | Telebirr / CBE Birr payment confirmation webhook |
| `/api/admin/config` | `GET / POST`| View or dynamically modify system policy at runtime |
| `/api/admin/config/set-free-period` | `POST` | Change the free launch cutoff date on the fly |
| `/api/admin/stats` | `GET` | Platform metrics (revenue, paid invoices, subscriptions) |
