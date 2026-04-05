# Chama Dudu: A High-Performance AI Delivery Orchestrator 🛵🍻

![Coding Animation](https://camo.githubusercontent.com/97e0d8993ad3e977093b6410cfdb4641b3ddafdf16b6d5081bc7bd8188ed0ffc/68747470733a2f2f63616d707573636f64652d736974652e73332d73612d656173742d1e616d617a6f6e6177732e636f6d2f6e6577736c65747465722f636f64696e675f706978656c732e676966)

## 📌 Executive Summary
**Chama Dudu** is a production-grade, hyper-local delivery engine that replaces traditional marketplace apps with a frictionless, AI-driven WhatsApp experience. It manages the entire lifecycle of a beverage order—from natural language intent to real-time depot matching and payment reconciliation—serving thousands of users in the Recife Metropolitan area (Paulista-PE).

> [!NOTE]
> This repository is a technical showcase of high-availability backend architecture, real-time geolocation matching, and Generative AI integration for enterprise-level automation.

---

## 🚀 The Core Challenge: Zero-Friction Commerce
Traditional delivery apps require downloads, accounts, and high commissions. **Chama Dudu** solves this by using WhatsApp as the primary OS, using a "Hero Persona" (Dudu) to facilitate orders through sheer speed and personality.

---

## 🧠 AI Innovation: Vertex AI + RAG Architecture
This platform doesn't just "chat"—it thinks. By integrating **Google Vertex AI Search** with a custom **Retrieval-Augmented Generation (RAG)** pipeline, the system achieves:

- **Natural Language Ordering**: Users can type "Get me two cold Heineken 600ml and a bag of ice" without navigating menus.
- **Contextual Grounding**: The AI is grounded in a dynamic corpus of regional policies, availability rules, and neighborhood mapping.
- **Fail-Closed Intent Recognition**: Complex or ambiguous orders are resolved via vector-search-driven "hints," ensuring the system never misinterprets a critical field like delivery address or volume.

### 🛠 Technical Architecture
<img src="https://img.shields.io/badge/Frontend-Nuxt_3-00DC82?style=for-the-badge&logo=nuxtdotjs&logoColor=white" /> <img src="https://img.shields.io/badge/Backend-Firebase_Functions_v2-FFCA28?style=for-the-badge&logo=firebase&logoColor=black" /> <img src="https://img.shields.io/badge/AI_Engine-Google_Vertex_AI-4285F4?style=for-the-badge&logo=googlecloud&logoColor=white" /> <img src="https://img.shields.io/badge/Database-Firestore_NoSQL-FFCA28?style=for-the-badge&logo=firebase&logoColor=black" /> <img src="https://img.shields.io/badge/Messaging-WhatsApp_Business_API-25D366?style=for-the-badge&logo=whatsapp&logoColor=white" /> <img ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)/>

---

## 🏗 Key Engineering Highlights

### 1. The Intelligent Matching Engine & "Dudu Score"
To ensure a high SLA, I developed a proprietary ranking algorithm that routes orders based on:
- **Real-time Latency**: Depot response times within a 3-minute window.
- **Completion Rate**: Rewards partners with high fulfillment reliability.
- **Geo-Fenced Routing**: Multi-tenant architecture that isolates order streams by neighborhood and regional coverage.

### 2. High-Availability Serverless Backend
Built on **Firebase Functions v2**, the system handles:
- **Asynchronous Webhooks**: Real-time PIX payment reconciliation via Banco Inter.
- **Automated Billing Cycles**: Generation of weekly performance reports and commission QR codes for partner depots.
- **SLA Monitors**: Cron-based checkers that guarantee no order is left hanging.

### 3. War Room Operations Dashboard
A comprehensive administrative interface built with **Nuxt 3** and **MapLibre GL JS**, featuring:
- **Vector Tile Geolocation**: Visualizing active orders across map layers.
- **Demand Forecasting**: Predictive analytics to signal high-volume windows to partner depots.
- **System Maintenance Mode**: Remote CLI access via WhatsApp for on-the-ground technical adjustments.

---

## 🏛 Project Structure (High-Level)

- **`/functions`**: The heart of the platform. Contains the FSM (Finite State Machine) for WhatsApp flows, AI grounding logic, and the payment engine.
- **`/chamaDudu_Website`**: The administrative and public-facing portal, optimized for performance and real-time state synchronization.
- **`/docs`**: Comprehensive documentation on release gates, deployment safeguards, and disaster recovery runbooks.

---

## 🛡 Security & Resilience
The platform implements enterprise-grade security protocols:
- **Zero-Secret GitHub Posture**: All sensitive production identifiers and keys are isolated via environment variables and secret managers.
- **Automated Release Gates**: CI/CD pipelines that validate rollout configurations and historical data audit compliance before every deploy.

---

> [!CAUTION]
> **PORTFOLIO NOTE**: This code handles real transactional value. The "Frustrated Developer" comments discovered in the codebase are a direct result of the high-pressure, real-world constraints of maintaining a 24/7 delivery infrastructure with 99.9% uptime.

*Built with ❤️ (and a lot of coffee) by a Frustrated Developer.*
