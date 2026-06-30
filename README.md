# ebayList

CLI helper for eBay listing work.

## For non-terminal users

Double-click `Launch ebayList.command`.

The launcher installs the app dependencies if needed, then opens Shopify in a browser window. Complete Shopify login and any 2FA once; future launches reuse the saved browser session in `.auth/profile`.

## Setup

```sh
pnpm install
pnpm auth
```

`pnpm auth` opens Shopify in a real browser window using the saved profile in `.auth/profile`. Complete Shopify login and any 2FA once; future runs reuse that session.

## Commands

- `pnpm auth` - open Shopify and save the authenticated browser session
- `pnpm start` - verify the saved Shopify session
- `pnpm start -- --headless` - verify the saved session without opening the browser

Shopify config lives in `src/config.ts`.
