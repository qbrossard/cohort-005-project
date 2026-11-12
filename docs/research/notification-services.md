# Hosted notification services compared with building on SQLite

Research for [issue #3](https://github.com/qbrossard/cohort-005-project/issues/3). It feeds the choice made in [issue #5](https://github.com/qbrossard/cohort-005-project/issues/5).

This document gathers facts only. It does not rank the options or recommend one.

- **Date checked:** every external page was read on 2026-11-12. Prices, plan limits and SDK versions are as of that date.
- **Sources:** each vendor's own docs, pricing page, GitHub repos and npm registry entries; the React Router docs and MDN for the build-on-SQLite option; this repo's own files for the app side.
- **Scope:** the in-app channel only. Email, push and SMS are mentioned only where they change pricing or setup.
- **Marking:** a claim with no primary source is tagged **Unverified**; a conclusion drawn from sourced facts rather than quoted from a page is tagged **Inference**. Section 9 collects every unverified item.

## 1. What the app needs a provider to fit

These facts come from the repo and are what each option is judged against.

- **Server-rendered React Router 8.** `react-router` is pinned at `8.3.0`, with `ssr: true` in `react-router.config.ts`. Data is read in loaders and written in actions.
- **One SQLite file.** ADR 0006 (`docs/adr/0006-one-sqlite-file-through-drizzle.md`) keeps all data in `data.db` through Drizzle and `better-sqlite3`: "`better-sqlite3` is synchronous, so a loader reads its data without a round trip." Its stated consequence is that "the app cannot run on more than one machine against the same data."
- **No real login.** `app/lib/session.ts` stores a numeric `userId` in a cookie session. The DevUI panel posts to `app/routes/api.switch-user.ts`, which sets the cookie and redirects. `users.id` is an auto-increment integer in `app/db/schema.ts`.
- **The app shell already loads per-user data.** The loader in `app/routes/layout.app.tsx` reads the current user id on every request and returns shell data (current user, recent courses, team-admin flag).
- **The mailer is the precedent for an external service.** `app/lib/mailer.server.ts` sends through Postmark when `POSTMARK_SERVER_TOKEN` is set and otherwise writes each email to `.outbox/` as JSON, behind a `MailTransport` interface. Dev and tests need no network.
- **Tests run against in-memory SQLite.** `app/test/setup.ts` creates a fresh `:memory:` database and applies the same Drizzle migrations as the live one.
- **No live-update code exists yet.** `app/` has no `EventSource`, `text/event-stream` or `useRevalidator` usage (searched 2026-11-12).

ADR 0006, the mailer and the **Notification** glossary entry are not on `main`, which this research branch was cut from. They were read from the local `add-refund-glossary` branch, which was not on `origin` on 2026-11-12, so they are named by path and not linked.

## 2. Comparison at a glance

| Criterion | Knock | Novu | MagicBell | Courier | Build on SQLite |
| --- | --- | --- | --- | --- | --- |
| Loader reads the feed, action marks read (server-side) | Yes, with the secret key | Yes, with the secret key | Per-user JWT only; server use is not shown in docs (**Inference**) | Not documented; inbox reads need the browser SDK | Yes, synchronous Drizzle queries |
| Send from server code | Trigger a workflow built in Knock | Trigger a workflow built in Novu (5 on Free) | `POST /broadcasts`, no workflow needed | `POST /send` with inline content, no template needed | Insert a row |
| Fully custom UI | Yes: hooks, plain JS client, or REST | Yes: hooks, plain JS client, or REST | Yes, with the plain JS client only; no current hooks package | Yes: `useCourier()` hook or plain JS client | Yes, nothing else exists |
| Live delivery | WebSocket from browser to Knock | WebSocket from browser to Novu | WebSocket from browser to MagicBell | WebSocket from browser to Courier | Not built; polling or SSE is the app's to write |
| Runs with zero network | No | Cloud: no. Self-hosted: six containers | No | No | Yes |
| Identity for the browser SDK | Public key + user id; signed JWT optional | App identifier + subscriber id; HMAC optional | Signed JWT required, signed locally | JWT required, minted by a Courier API call | Not applicable; cookie session |
| Free tier | 10,000 messages/month | 10,000 workflow runs/month | 1,000 deliveries/month | 10,000 sends/month | No fee |
| First paid step | Starter, $250/month for 50,000 | Pro, from $30/month for 30,000 | Startup, $249/month for 50,000 | Business, $0.005 per send from the first send | No fee |
| Where Notifications and read state live | Knock, US only | Novu Cloud (US or EU), or own MongoDB if self-hosted | MagicBell, region not published | Courier, US (EU on paid plans) | `data.db` |
| Feed retention | Indefinite | 30 days on Free, 90 on Pro | Not published | Until archived or expired | The app decides |

## 3. Knock

Packages checked: `@knocklabs/node` 1.41.1, `@knocklabs/client` 0.23.1, `@knocklabs/react-core` 0.17.1, `@knocklabs/react` 0.15.1 ([npm registry](https://registry.npmjs.org/@knocklabs/node)).

### Fit with React Router

- **Server SDK:** `@knocklabs/node` authenticates with a secret key read from `KNOCK_API_KEY` ([README](https://github.com/knocklabs/knock-node/blob/main/README.md), [API keys](https://docs.knock.app/api-reference/overview/api-keys)).
- **Sending:** there is no "create feed item" call. Server code triggers a workflow that contains an in-app step: `client.workflows.trigger(key, { recipients, data })`, which is `POST /v1/workflows/{key}/trigger` and runs asynchronously ([trigger](https://docs.knock.app/api-reference/workflows/trigger)). The quick start builds the workflow in Knock's dashboard ([React quick start](https://docs.knock.app/getting-started/quick-start/react)).
- **Reading in a loader:** `client.users.feeds.listItems(userID, channelId, params)` is `GET /v1/users/{user_id}/feeds/{id}`. It returns the entries plus `meta: { total_count, unread_count, unseen_count }` ([api.md](https://github.com/knocklabs/knock-node/blob/main/api.md), [list feed items](https://docs.knock.app/api-reference/users/feeds/list_items)).
- **Marking read in an action:** `client.messages.markAsSeen`, `markAsRead`, `archive` and their batch forms ([api.md](https://github.com/knocklabs/knock-node/blob/main/api.md)).
- **Knock's own position on proxying:** "You can avoid authentication altogether by proxying requests to Knock via your backend, although we don't recommend this approach as it will add more latency for your users." ([security and authentication](https://docs.knock.app/in-app-ui/security-and-authentication))
- **Rate limit:** listing a feed and marking read are tier 2, "5 requests / second", scoped "per-user and per-environment" ([rate limits](https://docs.knock.app/api-reference/overview/rate-limits)).
- **React Router:** no first-party page addresses React Router framework mode. **Unverified.**

### Custom UI

- **Headless is supported:** "Using our `@knocklabs/react` and `@knocklabs/client` libraries, you can create fully custom notification UIs that are backed by the Knock Feed API and real-time service." ([headless feed](https://docs.knock.app/in-app-ui/react/headless/feed))
- **Three routes:** React hooks without UI (`@knocklabs/react-core`, peer `react ^17 || ^18 || ^19`), a plain JS `FeedClient` (`@knocklabs/client`), or the REST feed endpoint rendered by the app's own loader.
- **Pricing page:** "Bring your own components: Yes" on every plan ([pricing](https://knock.app/pricing)).
- **Branding:** "Remove Knock branding" is "No" on Free and "Yes" on Starter ([pricing](https://knock.app/pricing)). The prebuilt `NotificationFeed` renders a "Powered by Knock" link when the feed settings return `branding_required: true` ([source](https://github.com/knocklabs/javascript/blob/main/packages/react/src/modules/feed/components/NotificationFeed/NotificationFeed.tsx)). Whether a custom UI on Free must show branding is **Unverified**.

### Live delivery

- **Transport:** "Knock provides a real-time web socket connection for your users to subscribe to new messages being produced on an in-app channel." ([API overview](https://docs.knock.app/in-app-ui/api-overview))
- **The browser connects to Knock directly.** The SDK manages the socket ([socket behavior](https://docs.knock.app/in-app-ui/feeds/socket-behavior)). The `new-message` event carries badge counts, not message content; the client then fetches over HTTP.
- **A loader-and-action-only integration gets no push.** No server-side subscription or SSE for feeds was found in the docs.
- **Connection limits:** none stated on the pricing page. **Unverified.**

### Local dev and tests

- **Zero network: no vendor-provided way.** No offline mode, emulator or self-hosted server was found, and the server is not open source ([GitHub org](https://github.com/knocklabs)).
- **What exists is cloud environments,** each with its own keys and isolated data ([environments](https://docs.knock.app/version-control/environments)).
- **No sandbox for in-app:** "The in-app channel doesn't support sandbox mode." Usage in any environment is billable ([plans](https://docs.knock.app/manage-your-account/knock-plans)).
- **Hooks a self-built fake could use:** the Node SDK's `baseURL` (`KNOCK_BASE_URL`) and `KnockProvider`'s `host` and `enabled={false}` props ([client.ts](https://github.com/knocklabs/knock-node/blob/main/src/client.ts), [KnockProvider](https://docs.knock.app/in-app-ui/react/sdk/components/knock-provider)).

### User switching

- **Default is public key plus a bare user id:** "Enhanced security mode is off by default, so you can build and test your in-app integration with only your public key." ([security and authentication](https://docs.knock.app/in-app-ui/security-and-authentication))
- **Knock's warning:** "Without enhanced security mode, a request with your public key can act as any user."
- **Enhanced security is optional per environment.** When on, the client needs an RS256 JWT whose `sub` is the user id. Signing is local, "without an additional network request" (`signUserToken`).
- **Users are upserted inline.** Server triggers must pass recipients as objects, "even if they only contain an `id` property" ([identifying recipients](https://docs.knock.app/managing-recipients/identifying-recipients)).
- **Switching:** server calls take the user id as an argument. The client re-authenticates when the id changes and reconnects the socket ([knock.ts](https://github.com/knocklabs/javascript/blob/main/packages/client/src/knock.ts)).

### Pricing

- **Unit:** "A single message delivered to a single user on a single channel." One in-app Notification is one message ([pricing](https://knock.app/pricing)).
- **Free:** "$0 / month", "up to 10,000" messages. "We don't hard cap your messages."
- **First paid step, Starter:** "$250 / month + additional usage", "50,000 then $0.005/ea".

### Where the data lives

- **With Knock:** user records, rendered message content, the trigger `data` payload, per-message `seen_at`, `read_at` and `archived_at`, and preferences ([API overview](https://docs.knock.app/in-app-ui/api-overview)).
- **Trigger data reaches the browser by default** unless an API response filter is configured ([feeds](https://docs.knock.app/integrations/in-app/feeds)).
- **Feed retention:** "In-app feed notifications are available indefinitely." Logs are kept 30 days below Enterprise ([data retention](https://docs.knock.app/manage-your-account/data-retention)).
- **Region:** "personal information you provide to us will be processed and stored in the US" ([privacy policy](https://knock.app/legal/privacy-policy)). "EU data residency is coming soon. We expect to support EU data residency by the end of 2026." ([security](https://docs.knock.app/developer-tools/security))
- **In the app's database:** nothing is required beyond the existing `users` table. The workflow and channel configuration live in Knock.

## 4. Novu

Packages checked: `@novu/api` 3.19.1, `@novu/react` 3.19.2, `@novu/js` 3.19.2 ([npm registry](https://registry.npmjs.org/@novu/api)). `@novu/node` is deprecated.

### Fit with React Router

- **Server SDK:** `@novu/api` with `new Novu({ secretKey })` ([TypeScript SDK](https://docs.novu.co/platform/sdks/server/typescript.md)).
- **Sending:** `novu.trigger({ workflowId, to: { subscriberId }, payload })`, `POST /v1/events/trigger`. A workflow with an in-app step must exist first. The Free plan allows "Up to 5 workflows" ([pricing](https://novu.co/pricing)).
- **Reading in a loader:** `novu.subscribers.notifications.list({ subscriberId })` (`GET /v2/subscribers/{subscriberId}/notifications`) and `.count(...)`, both under secret-key auth ([OpenAPI spec](https://api.novu.co/openapi.json), [SDK docs](https://github.com/novuhq/novu-ts/blob/main/docs/sdks/novunotifications/README.md)).
- **Marking read in an action:** `markAsRead`, `markAsSeen`, `markAllAsRead`, `archive`, `delete` on the same resource.
- **Rate limit:** Free is 30 requests per second for these calls ([rate limiting](https://docs.novu.co/api-reference/rate-limiting.md)).
- **React Router:** there is no `@novu/react-router` or `@novu/remix` package. A "Remix" quickstart renders `<Inbox />` in `app/root.tsx` using `@novu/react` ([Remix quickstart](https://docs.novu.co/platform/quickstart/remix.md)). `@novu/react` peers on React 18 or 19 and has no router peer. No page mentions React Router 7 or 8 framework mode. **Unverified.**
- **Server rendering:** the server entry of `@novu/react` is stubs; components render nothing during SSR and fetch in the browser ([source](https://github.com/novuhq/novu/blob/next/packages/react/src/server/index.tsx)).

### Custom UI

- **Headless is supported:** "Build a fully custom notification inbox with Novu's headless React hooks without being constrained by the default `<Inbox />` UI or dependencies." Hooks include `useNotifications` and `useCounts` ([headless mode](https://docs.novu.co/platform/inbox/headless-mode.md)).
- **Three routes:** the hooks in `@novu/react`, the plain client `@novu/js`, or the app's own components fed by loaders through `@novu/api`.
- **Branding:** "Users on a paid plan can remove the Novu branding from the Inbox UI and Emails." "This toggle is disabled on the free plan." ([prepare for production](https://docs.novu.co/platform/inbox/prepare-for-production.md)) Whether branding appears in headless mode on Free is **Unverified**.

### Live delivery

- **Transport:** "The Novu client provides real-time event handling through WebSocket connections." ([JavaScript SDK](https://docs.novu.co/platform/sdks/javascript.md))
- **The browser connects to Novu directly,** at `api.novu.co` and `wss://ws.novu.co` for the US region ([security](https://docs.novu.co/platform/additional-resources/security.md)).
- **A loader-and-action-only integration gets no push.** No server-side stream appears in the OpenAPI spec.
- **Connection limits:** none stated. **Unverified.**

### Local dev and tests

- **Novu Cloud cannot run offline.**
- **Self-hosting is possible.** The core is MIT-licensed ([README](https://github.com/novuhq/novu/blob/next/README.md)). The community Docker Compose file runs six services: `redis`, `mongodb`, `api`, `worker`, `ws` and `dashboard` ([docker-compose.yml](https://github.com/novuhq/novu/blob/next/docker/community/docker-compose.yml)).
- **Sizing guidance for one machine:** "All Novu services (API, Worker, WS, Dashboard) | 4 vCPUs, 8 GB RAM", plus MongoDB and Redis at 2 GB each ([self-hosting overview](https://docs.novu.co/community/self-hosting-novu/overview.md)).
- **No lighter local mode.** `npx novu dev` tunnels to Novu Cloud ([studio](https://docs.novu.co/framework/studio.md)).
- **No official mock.** `@novu/api`'s `HTTPClient` accepts a custom `fetcher` "when writing tests to mock out the HTTP client and feed in fixtures" ([README](https://github.com/novuhq/novu-ts/blob/main/README.md)).
- **Self-hosted telemetry:** "The Novu server sends a keep-alive ping every hour ... This data is collected regardless of whether telemetry is enabled or disabled." ([telemetry](https://docs.novu.co/community/self-hosting-novu/telemetry.md))

### User switching

- **The client takes a public `applicationIdentifier` and a `subscriberId`,** with an optional `subscriberHash` ([prepare for production](https://docs.novu.co/platform/inbox/prepare-for-production.md)).
- **HMAC is optional and off by default.** Without it, "a malicious actor could potentially guess another subscriber's `subscriberId` and use your public `applicationIdentifier` to view that user's notifications." When on, the hash is `HMAC-SHA256(secretKey, subscriberId)`, computed locally on the server.
- **Subscribers are created inline** on trigger or on first Inbox session ([subscribers](https://docs.novu.co/platform/concepts/subscribers.md)).
- **Switching:** server calls take `subscriberId` as a parameter. On the client, `NovuProvider` builds a new client when the `subscriberId` prop changes ([source](https://github.com/novuhq/novu/blob/next/packages/react/src/hooks/NovuProvider.tsx)).

### Pricing

- **Unit:** the workflow run. "Triggering a workflow to a single subscriber counts as 1 run." Runs are counted "across all environments" ([pricing](https://novu.co/pricing)).
- **Free:** "$0 / month", "10,000 workflow runs / month", "Up to 5 workflows", "Activity feed retention: 24 hours".
- **First paid step, Pro:** "Starting from $30 / month", "30,000+ workflow runs / month", additional runs "$1.20 per 1K", "Remove Novu branding".
- **Self-hosted:** no licence fee for the MIT core. Code under `/enterprise` needs Novu's written approval ([LICENSE-ENTERPRISE](https://github.com/novuhq/novu/blob/next/LICENSE-ENTERPRISE)).
- **Free past 10,000 runs:** not stated. **Unverified.**

### Where the data lives

- **With Novu Cloud:** "Novu stores workflow definitions, subscriber profiles, and delivery logs." In-app messages and their read, seen and archived state are held there too ([pricing FAQ](https://novu.co/pricing)).
- **Region:** US (Virginia) or EU (Frankfurt) on all plans, chosen at account creation and not movable afterwards ([security](https://docs.novu.co/platform/additional-resources/security.md)).
- **Inbox message retention:** 30 days on Free, 90 days on Pro and Team ([security](https://docs.novu.co/platform/additional-resources/security.md), [limits](https://docs.novu.co/platform/developer/limits.md)).
- **Self-hosted:** data sits in MongoDB with Redis for queues ([.env.example](https://github.com/novuhq/novu/blob/next/docker/community/.env.example)).
- **In the app's database:** nothing is required. **Inference:** a Notification that must outlive the retention window would have to be stored by the app.

## 5. MagicBell

Packages checked: `magicbell-js` 1.8.0, `@magicbell/react` 1.14.0 ([npm registry](https://registry.npmjs.org/magicbell-js)). API v2 is current; v1 (API key, secret and optional HMAC) is deprecated ([API docs](https://www.magicbell.com/docs/api)). Older packages `@magicbell/react-headless`, `@magicbell/magicbell-react` and `magicbell` are deprecated.

### Fit with React Router

- **Two credentials:** a Project JWT for server-to-server calls and a User JWT for one person's inbox ([authentication](https://www.magicbell.com/docs/api/authentication)).
- **Sending:** `client.broadcasts.createBroadcast(...)`, `POST /broadcasts`, with the Project JWT. No workflow is needed; `recipients` and `title` are required ([BroadcastsService](https://github.com/magicbell/magicbell-js/blob/main/packages/magicbell-js/docs/project-client/services/BroadcastsService.md)).
- **Reading and marking read need a User JWT.** `listNotifications`, `fetchUnreadNotificationsCount`, `markNotificationRead`, `markNotificationSeen` and `archiveNotification` are on `magicbell-js/user-client` ([NotificationsService](https://github.com/magicbell/magicbell-js/blob/main/packages/magicbell-js/docs/user-client/services/NotificationsService.md)). The project API has no notification-reading endpoint ([project spec](https://www.magicbell.com/docs/api/openapi.project.json)).
- **Doing that in a loader:** **Inference.** The server can sign a User JWT locally and the client is documented for Node, but no first-party example shows inbox reads from a server, and it was not run.
- **Rate limit:** "The REST API imposes a limit of 500 req/minute counted per IP address." ([API docs](https://www.magicbell.com/docs/api)) **Inference:** calls made from loaders all come from the app server's one IP.

### Custom UI

- **Headless route:** `magicbell-js`, described on npm as "plain js if you want to wire up the UI yourself" ([@magicbell/embeddable](https://www.npmjs.com/package/@magicbell/embeddable)). It has data methods and a `Realtime` class and no UI.
- **No current React hooks package.** `@magicbell/react` exports components only, and `@magicbell/react-headless` is deprecated ([npm](https://www.npmjs.com/package/@magicbell/react-headless)).
- **Prebuilt UI customisation:** `Inbox` accepts an `ItemComponent`; styling is by CSS variables ([magicbell-react](https://www.magicbell.com/docs/libraries/magicbell-react)).
- **Branding:** the pricing page says nothing. The prebuilt `Inbox` in 1.14.0 renders a footer with the MagicBell logo and no prop to turn it off (read from the package source). Whether it can be removed on any tier is **Unverified**.
- **SDK licence:** the repo's licence is proprietary and says you may not "remove any proprietary notices or branding from the Software" ([LICENSE](https://github.com/magicbell/magicbell-js/blob/main/LICENSE)).

### Live delivery

- **Transport:** "Notifications update live via WebSockets. No polling, no custom infra required." ([inbox](https://www.magicbell.com/inbox))
- **The browser connects to MagicBell directly,** at `wss://ws.magicbell.com`, authenticated with the User JWT. The server pushes a notification id and the client fetches it over REST ([realtime.ts](https://github.com/magicbell/magicbell-js/blob/main/packages/magicbell-js/src/realtime.ts)).
- **A server-side relay is not documented.**
- **Connection limits:** none stated. **Unverified.**

### Local dev and tests

- **Zero network: no.** No offline mode, emulator, self-hosted server, sandbox or official mock was found ([GitHub org](https://github.com/magicbell)).
- **Environment separation is separate cloud projects.** The free plan includes "1 Project" ([quick start](https://www.magicbell.com/docs/quick-start), [pricing](https://www.magicbell.com/pricing)).
- **Hooks a self-built fake could use:** the SDK's `baseUrl` config, and `baseUrl` and `socketUrl` props on the React provider that are marked internal.

### User switching

- **A User JWT is required in v2.** It carries `user_external_id` and `api_key`, signed HS256 with the project's Secret Key ([user authentication](https://www.magicbell.com/docs/api/authentication/user)).
- **Signing is local:** "JWT-based auth you sign yourself. No extra API calls." ([inbox](https://www.magicbell.com/inbox))
- **Integer ids:** "If you use an integer to identify users, remember to cast it to a string before sending it to MagicBell." ([user](https://www.magicbell.com/docs/primitive/user))
- **Users are created on the fly** "when you initialize the Inbox for them, using the user auth token" ([quick start](https://www.magicbell.com/docs/quick-start)). Whether a broadcast to a new `external_id` creates the user is **Unverified**.
- **Switching:** sign a new JWT for the new id and pass it to the client; the client and socket are rebuilt per token.

### Pricing

- **Unit:** the delivery. "To count deliveries, we add up all the channels a user receives a notification on." One in-app Notification to one person is one delivery ([pricing](https://www.magicbell.com/pricing)).
- **Free, Builder:** "$0 /month", "1,000 Deliveries/mo.", "1 Project".
- **First paid step, Startup:** "$249 /month", "50,000 Deliveries/mo.", "5 Projects", "$0.0025 per additional Delivery".
- **Builder past 1,000 deliveries:** not stated. **Unverified.**

### Where the data lives

- **With MagicBell:** user records, notification title and content, and `seenAt`, `readAt` and `archivedAt` state, plus preferences ([Notification model](https://github.com/magicbell/magicbell-js/blob/main/packages/magicbell-js/docs/user-client/models/Notification.md)).
- **Region and data residency:** not published on the pricing, security or docs pages. **Unverified.**
- **Retention:** no per-plan period is published. **Unverified.**
- **In the app's database:** nothing is required beyond the existing `users` table.

## 6. Courier

Packages checked: `@trycourier/courier` 10.0.0 (Node), `@trycourier/courier-react` 9.3.5, `@trycourier/courier-js` 3.7.1 ([npm registry](https://registry.npmjs.org/@trycourier/courier)). The older `@trycourier/react-inbox`, `react-provider` and `react-hooks` are deprecated.

### Fit with React Router

- **Server SDK:** `@trycourier/courier`, reading `COURIER_API_KEY` ([Node SDK](https://www.courier.com/docs/sdk-libraries/node.md)).
- **Sending:** `client.send.message(...)`, `POST /send`, with `routing.channels: ["inbox"]`. Content can be inline (`title` and `body`) with no template ([add an inbox to React](https://www.courier.com/docs/guides/add-an-inbox-to-react.md)).
- **Reading or marking read from the server is not documented.** The REST reference has no Inbox section ([API reference index](https://www.courier.com/docs/_llms/api-reference.txt)). Courier describes the split: "Issue scoped, short-lived JWTs so client-side SDKs — Inbox, Preferences, and the embedded designer — can call Courier as a single user. Server-side requests authenticate with your workspace API key instead." ([create a JWT](https://www.courier.com/docs/api-reference/authentication/create-a-jwt.md))
- **Inbox reads and writes live in the browser SDK** `@trycourier/courier-js`, over GraphQL to `inbox.courier.com` with the per-user JWT ([courier-js](https://www.courier.com/docs/sdk-libraries/courier-js-web.md)). Whether that client runs in Node is **Unverified**.
- **What a loader or action can do per the docs:** send a message and mint the user's JWT.
- **Server rendering:** "Courier Inbox and Toast support Next.js but render client-side only." ([courier-react](https://www.courier.com/docs/sdk-libraries/courier-react-web.md)) Nothing addresses React Router. **Unverified.**

### Custom UI

- **Headless is supported:** "You don't have to render `CourierInbox` at all. Every SDK exposes the message data and actions directly, so you can build the whole UI while the SDK keeps everything synced." ([build a custom inbox](https://www.courier.com/docs/in-app/build-a-custom-inbox.md))
- **Routes:** the `useCourier()` hook in `@trycourier/courier-react` (peer `react >=18.0.0`), render props on `<CourierInbox />`, or the plain client `@trycourier/courier-js`.
- **React 19:** inside the peer range, and the package's own dev dependencies use React 19.1.0. The docs say only "React 18+".
- **Branding:** no "Powered by Courier" requirement was found on the pricing or inbox pages. **Unverified.**

### Live delivery

- **Transport:** WebSocket. "Once a user signs in, the inbox opens a realtime connection." ([how the inbox behaves](https://www.courier.com/docs/in-app/how-the-inbox-behaves.md))
- **The browser connects to Courier directly:** "The inbox calls Courier directly from the browser, so a site with a CSP has to allow these." ([add an inbox](https://www.courier.com/docs/in-app/add-an-inbox.md))
- **A custom UI must open the socket itself** with `inbox.listenForUpdates()`: "Without it, the inbox loads once and doesn't update again."
- **An expired token stops updates** until the app signs in again with a fresh one.
- **Connection limits:** none stated. **Unverified.**

### Local dev and tests

- **Zero network: no.** "Courier is a managed cloud platform, with no self-hosted or on-premise option." ([security](https://www.courier.com/docs/workspaces/security.md))
- **The only non-production option is the cloud Test environment:** "Courier has no separate test mode: a Test key is what puts you in the Test environment." ([environments](https://www.courier.com/docs/workspaces/environments.md))
- **Test sends are billed:** "Sends made with a Test key count the same as Production sends." ([billing](https://www.courier.com/docs/workspaces/billing.md))
- **Testing guidance is to mock the hook yourself:** "mock `useCourier()` in tests to return test data". No mock package is offered.

### User switching

- **A JWT is required:** "Client keys no longer authenticate anything, so every app needs a backend endpoint that issues a token." ([v8 migration guide](https://www.courier.com/docs/sdk-libraries/courier-react-v8-migration-guide.md))
- **Minting is a network call to Courier:** `client.auth.issueToken({ scope: "user_id:... inbox:read:messages inbox:write:events", expires_in })`, `POST /auth/issue-token` ([authenticate users](https://www.courier.com/docs/in-app/authenticate-users.md)).
- **No auto-refresh:** "The SDKs do **not** refresh tokens."
- **The user id is the app's own:** "Nothing has to exist in Courier first, since signing in registers the user."
- **Switching:** mint a new JWT for the new id and call `signIn` again; "A second `signIn` signs the first user out again".
- **Courier's guidance on the token route:** "Take the user id from your session, never from the request body or a query parameter."
- **Token expiry:** two first-party pages disagree on whether `expires_in` is optional. **Unverified.**

### Pricing

- **Unit:** the send. "One send is one template sent to one recipient." "Sends from Test and custom environments count the same as Production." ([pricing](https://www.courier.com/pricing))
- **Free, Developer:** "10,000 sends per month". The inbox "has no fee of its own" ([billing](https://www.courier.com/docs/workspaces/billing.md)).
- **First paid step, Business:** "$0.005 per send", pay as you go. "Business charges $0.005 for every send, including the first 10,000." Adding a credit card moves a workspace to Business.

### Where the data lives

- **With Courier:** "Courier stores each user's messages and delivers them in real time. Read and archive state stays in sync across every device." ([inbox](https://www.courier.com/docs/in-app/inbox.md))
- **Inbox retention:** "A message stays in the feed until it is archived or expires." Send logs are kept 30 days on Developer and Business ([logs](https://www.courier.com/docs/monitor/logs.md)).
- **Region:** "Courier has two datacenters: US and EU (Ireland)." "The EU datacenter is available on every paid plan: Business and Enterprise." ([datacenters](https://www.courier.com/docs/workspaces/datacenters.md))
- **In the app's database:** nothing is required for the feed. **Inference:** because no documented server endpoint reads inbox state and no webhook reports read or archived, a server-side copy of read state would have to be written by the app.

## 7. Build on SQLite

### Fit with React Router

- **Reads and writes are ordinary loaders and actions.** A loader queries `data.db` synchronously through Drizzle, with no round trip (ADR 0006).
- **The shell loader is already per-user.** `app/routes/layout.app.tsx` resolves the current user id on every request, so an unread count or a list could be returned alongside the existing shell data.
- **Revalidation is automatic:** "In framework mode with SSR, route loaders are automatically revalidated after all navigations and form submissions." ([route module](https://reactrouter.com/start/framework/route-module)) "When the action completes, all loader data on the page is revalidated to keep your UI in sync with the data without writing any code to do it." ([actions](https://reactrouter.com/start/framework/actions))
- **Marking read without navigating:** "Fetchers allow you to submit data to actions (and loaders) without causing a navigation." ([actions](https://reactrouter.com/start/framework/actions))
- **Version note:** these docs describe React Router 8.5.1; the app pins 8.3.0.

### Custom UI

- **Everything is the app's own components.** Nothing prebuilt exists. The repo already depends on `radix-ui`, `lucide-react` and `shadcn` for UI.

### Live delivery

Nothing is built in. Three levels exist, each sourced below.

- **No extra work:** a Notification appears on the person's next navigation or form submission, because loaders revalidate then (quoted above).
- **Polling:** `useRevalidator` exists to "Revalidate the data on the page for reasons outside of normal data mutations like `Window` focus or polling on an interval." ([useRevalidator](https://reactrouter.com/api/hooks/useRevalidator)) The page gives a focus example and no polling example.
- **Server-sent events:**
  - **Server side:** a resource route is a route module that "exports a loader or action but does not export a default component", and it can "return `Response` instances" ([resource routes](https://reactrouter.com/how-to/resource-routes)). The page does not mention streaming or `text/event-stream`. **Inference:** a streaming `Response` would work; not confirmed by the docs and not run.
  - **Browser side:** "create a new `EventSource` object with the URL of a script that generates the events"; the server must "respond using the MIME type `text/event-stream`" ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)).
  - **Reconnection is built in:** "By default, if the connection between the client and server closes, the connection is restarted."
  - **Connection limit:** "When **not used over HTTP/2**, SSE suffers from a limitation to the maximum number of open connections, which can be especially painful when opening multiple tabs, as the limit is _per browser_ and is set to a very low number (6)."
  - **Signalling open streams:** **Inference.** ADR 0006 says the app runs as one server process, so an in-process signal from the code that writes a Notification could reach every open stream. No such mechanism exists in the repo today.
  - **Session cookie on the stream:** **Unverified.** MDN's `withCredentials` page covers cross-origin use only; that a same-origin `EventSource` sends the session cookie was not confirmed from a page read.

### Local dev and tests

- **No network at all.** Dev uses `data.db`; tests use `createTestDb()` in `app/test/setup.ts`, an in-memory database with the real migrations.
- **A schema change is needed:** a new table means a Drizzle migration and a seed update (the repo's `database-migrations` skill covers this).

### User switching

- **Works with no extra step.** The current user comes from the cookie session (`getCurrentUserId`). The DevUI posts to `/api/switch-user`, which redirects, so every loader runs again as the new user.
- **No token, key or identify call exists to manage.**

### Pricing

- **No fee and no usage limit.** The cost is build and maintenance work, which this research does not estimate.

### Where the data lives

- **Entirely in `data.db`,** in line with ADR 0006. Content, read state and retention are all the app's to define.

## 8. Facts that apply to every hosted service

- **Live delivery always means the browser talks to the vendor.** All four deliver over a WebSocket opened from the browser to the vendor's host. None documents a server-side push that a loader could consume.
- **None ships an offline fallback like `.outbox/`.** Each needs either its cloud or, for Novu only, a self-hosted stack. A no-network mode would be the app's own fake behind an interface, as the mailer does it.
- **Seeded user ids would be shared.** **Inference:** user ids are auto-increment integers local to each developer's `data.db`, so two developers pointing at the same cloud environment or project would address the same hosted users (id 1, id 2 and so on).
- **Three of the four count dev and test usage against the plan:** Knock ("usage may be accrued in any Knock environment"), Novu (runs counted "across all environments") and Courier (Test sends "count the same"). MagicBell's page does not say.

## 9. Not verified

Checked on 2026-11-12 and not confirmed from a primary source:

- **React Router framework mode:** no vendor documents support for React Router 7 or 8 framework mode. Evidence is limited to React peer ranges and Next.js or Remix guidance.
- **Nothing was run.** Every claim is from documentation, published source or registry metadata. No SDK was installed and no API was called.
- **npm package pages** returned HTTP 403 for Knock and Courier; versions and peer ranges come from `registry.npmjs.org` instead.
- **Realtime connection limits:** not stated by any of the four.
- **Branding on a custom UI on a free tier:** not stated by Knock or Novu; no statement at all from MagicBell or Courier.
- **Knock:** how feed retention "can be configured"; whether a webhook fires on a new in-app message.
- **Novu:** what happens to a Free account past 10,000 runs; whether the self-hosted images expose the same `/v2/subscribers/{id}/notifications` endpoints as the cloud.
- **MagicBell:** notification retention per plan; hosting region and data residency; Builder behaviour past 1,000 deliveries; whether the Inbox footer logo can be removed; whether a broadcast to a new `external_id` creates the user; server-side inbox reads from a loader; whether the unread count includes unseen Notifications.
- **Courier:** whether the inbox GraphQL endpoint or `@trycourier/courier-js` can be used from Node; whether `expires_in` is optional on `/auth/issue-token` (two first-party pages disagree); whether sending to a never-seen `user_id` needs a profile first (three pages say no, the Node SDK page's wording suggests yes).
- **SQLite option:** a streaming `text/event-stream` response from a React Router resource route; the session cookie being sent on a same-origin `EventSource`.
