# OAuth

## Refresh Token

Use the refresh token to obtain a new access token without prompting the user again.

```bash
curl -X POST https://api.example.com/oauth/token \
  -d "grant_type=refresh_token" \
  -d "refresh_token=$REFRESH_TOKEN"
```

## Client Credentials

Use client credentials for server-to-server calls.
