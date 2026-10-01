# Home Maintenance

Track recurring home maintenance (filters, alarms, gutters, the water heater…), log when each job was done and what it cost, and get reminders in your phone's calendar.

Live at <https://home.roostercoop.tech>, behind the same Cognito login as Source Lens.

## How it works

- **Tasks** repeat every *n* days, weeks, months or years. The next due date is the last time it was done plus the interval, or the task's first due date if it hasn't been done yet. A task is **due soon** from *lead days* before its due date, and **overdue** after it.
- **Add common tasks** offers about 30 typical jobs. Seasonal ones (gutters, irrigation, furnace service…) start in a sensible month.
- **Done** logs the date, cost, vendor, notes and who was signed in, and moves the next due date on. **Snooze** pushes a due or overdue task back without logging it. Pausing a task hides it from the dashboard and the calendar.
- **History** filters by year or task, totals the cost, and exports CSV. Deleting a task keeps its history.
- **Reminders** come from a calendar feed (`/cal/<secret>.ics`) that you subscribe to once on your phone. Each task is an all-day event on its due date with a 9am alert, plus an early alert at 9am *lead days* before. Overdue tasks move to today until they're done. Calendar apps poll the feed, so the server never has to send anything. Google Calendar ignores the feed's own alerts, so set notifications for that calendar in Google instead. The settings page explains how to subscribe on each platform.

The calendar link is the only part that works without logging in (calendar apps can't sign in). It contains a random 32-character token. **Make a new link** in settings invalidates the old one.

## Run locally

Requires Node 22+.

```bash
npm install
npm run dev     # web app on http://localhost:5174, API on :8788
npm test
```

Data is saved in `data/home.json` (git-ignored). Locally there's no login; "done by" shows as "me".

## Deploy

Pushes to `web` that touch `home-maintenance/` run `.github/workflows/deploy-home.yml`: test, build the image, push it to ECR `source-lense-home`, then run the SSM document `source-lense-home-deploy`. The document installs and restarts the `home-maintenance` systemd unit on the Source Lens instance. The infrastructure is in `../infrastructure/home.tf`.

On the instance, data is in `/var/lib/source-lense/home-data/home.json` on the shared EBS volume, which is snapshotted daily.
