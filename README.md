# ebayList

CLI helper for eBay listing work, with a downloadable macOS app.

## Mac app (for non-technical users)

Download the `.dmg`, drag **ebayList** to Applications, and open it.

The app is not notarized by Apple, so the first launch is blocked: open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to ebayList. This is needed once.

In the app (all pages open as tabs inside the window — no separate browser):

1. Click **Log in to Shopify** the first time (complete login + 2FA in the Shopify tab; the session is remembered).
2. Click **Start listing run**. For each product the Google tab shows the category lookup; enter the eBay category number and choose **List on eBay**, **List on Motors**, **Skip**, or **Quit run**. The grid tabs stay editable before you choose.

Build the `.dmg` with `pnpm dist:mac` (output in `release/`). Run the app from source with `pnpm ui`. `EBAYLIST_SMOKE=1 pnpm ui` self-checks the embedded-tab automation without Shopify.

The CLI (`pnpm start`) still uses an external Google Chrome window.

## For non-terminal users (from source)

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
