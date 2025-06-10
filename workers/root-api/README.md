# API Gateway Router

A Cloudflare Worker that acts as an API gateway, routing requests to different service workers based on the URL path and stripping the base route before forwarding.

## Overview

This router receives requests at `api.keepr.digital/{service}/{path}` and forwards them to the appropriate service worker with the base path stripped.

**Example:**

- Request: `GET api.keepr.digital/users/123`
- Forwards to: `USER_SERVICE` with path `/123`

## Features

- 🚀 **Path Stripping**: Removes service name from path before forwarding
- 🔀 **Service Routing**: Routes to different workers based on first path segment
- 🛡️ **Error Handling**: Returns 404 for unknown services
- ⚡ **Fast**: Uses Cloudflare Service Bindings for internal communication

## Setup

### 1. Configure Service Bindings

Add your service workers to `wrangler.toml`:

```toml
[[services]]
binding = "<NEW_SERVICE_NAME>"
service = "<new-worker>"
```

### 2. Update Route Map

Edit the `ROUTE_MAP` in `src/index.ts` to match your services:

```typescript
const ROUTE_MAP = {
  op: 'OP_API_SERVICE'
  // Add more services here
} as const
```

## Project Structure

```
api-gateway/
├── src/
│   └── index.ts          # Main router logic
├── wrangler.toml         # Worker configuration
├── package.json
└── README.md
```

## How It Works

### Request Flow

1. **Incoming Request**: `GET api.keepr.digital/users/profile`
2. **Path Parsing**: Extracts `users` as service name
3. **Path Stripping**: Creates new request with path `/profile`
4. **Service Routing**: Forwards to `USER_SERVICE` worker
5. **Response**: Returns service worker response

### Path Examples

| Original Request    | Service         | Forwarded Path |
| :------------------ | :-------------- | :------------- |
| `/users`            | USER_SERVICE    | `/`            |
| `/users/123`        | USER_SERVICE    | `/123`         |
| `/orders/abc/items` | ORDER_SERVICE   | `/abc/items`   |
| `/payments/webhook` | PAYMENT_SERVICE | `/webhook`     |
