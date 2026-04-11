## Watch Party Vercel token service

This repo now includes a dedicated Vercel backend for Option 1 token minting at:

- `vercel/watch-party-token-service`

Deploy that folder to Vercel as its own project by setting the Vercel **Root Directory** to:

```text
vercel/watch-party-token-service
```

The deployed endpoint path will be:

```text
https://your-vercel-project.vercel.app/api/watch-party-token
```

### Required Vercel environment variables

Add these in the Vercel project settings:

```text
LIVEKIT_URL
LIVEKIT_API_KEY
LIVEKIT_API_SECRET
SUPABASE_URL
SUPABASE_ANON_KEY
```

Recommended values for `SUPABASE_URL` and `SUPABASE_ANON_KEY` should match the NOVA STREAM app's current Supabase project.

### What the endpoint does

- validates the Supabase bearer token sent by the app
- verifies the requested room exists
- verifies the user belongs to that Watch Party room
- mints a LiveKit participant token
- returns:

```json
{
  "token": "livekit-jwt",
  "url": "wss://your-livekit-host"
}
```

### Local app wiring after deploy

Once the Vercel project is deployed, point the app to it with:

```text
VITE_WATCH_PARTY_LIVEKIT_URL=wss://your-livekit-host
VITE_WATCH_PARTY_TOKEN_ENDPOINT=https://your-vercel-project.vercel.app/api/watch-party-token
```

The frontend already knows how to use this HTTP token service path.
