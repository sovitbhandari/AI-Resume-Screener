# Session contract

The API uses bearer tokens. It does not set cookies.

- `POST /api/auth/register` and `POST /api/auth/login` return `{ data: { token, user } }`.
- The token is an HS256 JWT. `expiresIn` is `AUTH_TOKEN_TTL` (default `12h`, maximum 7 days). There is no refresh token.
- Clients send `Authorization: Bearer <token>`. The browser app stores that token in `localStorage`.
- Any script that can run in the page origin can read `localStorage`. This is the XSS risk of a bearer token. Logout removes the token and `sessionStorage` key `latestResumeAnalysis`. Starting a session also clears that cache so one account does not keep another account's last result.
- Cookies are not used, so this contract does not add CSRF tokens. CORS allows the configured client origin and is not authorization.
- `TRUST_PROXY` defaults to `false`. Rate-limit keys then use the socket address. `TRUST_PROXY=true` trusts one proxy hop. A wrong setting lets callers spoof `X-Forwarded-For`. Limits are an in-memory map on one Node process, not a shared limit across instances.

Login is limited to 10 requests per 15 minutes per socket address. Registration is limited to 5. Authenticated parse and analyze are limited to 20 per hour per user id. Those numbers are single-instance configuration.
