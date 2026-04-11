## Watch Party Phase E config

NOVA STREAM now supports two transport-config paths:

- Desktop/Tauri native runtime:
  - `WATCH_PARTY_LIVEKIT_URL`
  - `WATCH_PARTY_LIVEKIT_API_KEY`
  - `WATCH_PARTY_LIVEKIT_API_SECRET`
- Web/external token service fallback:
  - `VITE_WATCH_PARTY_LIVEKIT_URL`
  - `VITE_WATCH_PARTY_TOKEN_ENDPOINT`

For the desktop app, the frontend asks Tauri for runtime config and token minting directly. For web-style setups, the client still sends a `POST` request to `VITE_WATCH_PARTY_TOKEN_ENDPOINT` with:

```json
{
  "roomId": "supabase-room-uuid",
  "roomCode": "ABC123",
  "identity": "supabase-user-id",
  "displayName": "profile username",
  "role": "host"
}
```

It also includes the current Supabase access token as:

```http
Authorization: Bearer <supabase-access-token>
```

The token service or native runtime should:

- validate the Supabase bearer token
- confirm the user belongs to the requested Watch Party room
- mint a LiveKit access token with room join permissions
- allow publish permissions for hosts only

Successful response shape:

```json
{
  "token": "livekit-jwt",
  "url": "wss://your-livekit-host"
}
```

`url` is optional if the transport config already provides the LiveKit URL.

### Vercel token-service option

If you want a deployable server-side token endpoint instead of desktop-local token minting, use the dedicated Vercel service in:

- `vercel/watch-party-token-service`

Deployment and environment setup are documented in:

- `docs/watchparty-vercel-token-service.md`
