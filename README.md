# ebayList

macOS app for eBay listing work. The automation drives the app's own embedded browser tabs — no separate Chrome window.

## Mac app (for non-technical users)

Download the `.dmg`, drag **ebayList** to Applications, and open it.

The app is not notarized by Apple, so the first launch is blocked: open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to ebayList. This is needed once.

In the app (all pages open as tabs inside the window — no separate browser):

1. Click **Log in to Shopify** the first time (complete login + 2FA in the Shopify tab; the session is remembered).
2. Click **Start listing run**. For each product the Google tab shows the category lookup; enter the eBay category number and choose **List on eBay**, **List on Motors**, **Skip**, or **Quit run**. The grid tabs stay editable before you choose.

## Running from source

Double-click `Launch ebayList.command`, or:

```sh
pnpm install
pnpm ui
```

Log in to Shopify inside the app the first time; the session is remembered in the app's own profile.

## Commands

- `pnpm ui` - build and open the app
- `pnpm dist:mac` - build the `.dmg` (output in `release/`)
- `pnpm typecheck` - type-check the sources
- `pnpm test` - run the unit tests
- `EBAYLIST_SMOKE=1 pnpm ui` - self-check the embedded-tab automation without Shopify
- `EBAYLIST_MODULE_TEST=1 pnpm ui` - exercise every browser-touching module end-to-end (stage-only, never commits)

Shopify config lives in `src/config.ts`.
