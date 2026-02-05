# GoWild Flight Monitor

Automated monitoring for Frontier GoWild flight deals with notifications.

## Features

- Scheduled scanning for GoWild-eligible flights
- Price threshold alerts (only notify when taxes/fees below target)
- Discord webhook notifications
- Duplicate alert prevention (won't spam same flight)
- Configurable origins, destinations, and scan interval

## Setup

### 1. Login to Frontier (One-Time)

First, you need to authenticate with Frontier:

```bash
# Start the web app
pnpm dev

# Open http://localhost:3000/settings
# Click "Login to Frontier" and complete login
# Your session will be saved automatically
```

### 2. Configure the Monitor

```bash
pnpm monitor:config
```

This will prompt you to configure:
- Origin airports (e.g., DEN, LAS)
- Destination mode (popular, all, or custom)
- Maximum price to alert on
- Days ahead to scan
- Scan interval
- Discord webhook URL (optional)

Configuration is saved to `data/monitor-config.json`.

### 3. Run the Monitor

**Single scan:**
```bash
pnpm monitor
```

**Continuous monitoring (daemon mode):**
```bash
pnpm monitor:daemon
```

## Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `origins` | Airport codes to search from | `["DEN"]` |
| `destinations` | Airports to search to | Popular destinations |
| `maxPrice` | Max taxes/fees to alert | `$50` |
| `intervalMinutes` | Time between scans | `60` |
| `daysAhead` | Days to look ahead | `2` |
| `goWildOnly` | Only GoWild flights | `true` |

## Discord Notifications

To receive Discord notifications:

1. Create a Discord webhook:
   - Server Settings > Integrations > Webhooks > New Webhook
   - Copy the webhook URL

2. Add to config:
   ```bash
   pnpm monitor:config
   # Enter the webhook URL when prompted
   ```

Or manually edit `data/monitor-config.json`:
```json
{
  "notifications": {
    "discord": {
      "webhookUrl": "https://discord.com/api/webhooks/..."
    },
    "console": true
  }
}
```

## Running as a Background Service

### Using PM2

```bash
# Install PM2
npm install -g pm2

# Start monitor
pm2 start "pnpm monitor:daemon" --name gowild-monitor

# View logs
pm2 logs gowild-monitor

# Stop
pm2 stop gowild-monitor
```

### Using systemd (Linux)

Create `/etc/systemd/system/gowild-monitor.service`:

```ini
[Unit]
Description=GoWild Flight Monitor
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/frontier-scanner
ExecStart=/usr/bin/pnpm monitor:daemon
Restart=always

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl enable gowild-monitor
sudo systemctl start gowild-monitor
```

### Using launchd (macOS)

Create `~/Library/LaunchAgents/com.gowild.monitor.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.gowild.monitor</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/pnpm</string>
        <string>monitor:daemon</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/frontier-scanner</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

Then:
```bash
launchctl load ~/Library/LaunchAgents/com.gowild.monitor.plist
```

## Tips

- **Session Expiry**: Frontier sessions expire after ~7 days. Re-login via the web app when needed.
- **Rate Limiting**: The scanner has built-in rate limiting. Don't set interval too low.
- **Popular Destinations**: Use popular destinations mode for faster scans.
- **Price Alerts**: GoWild flights are $0.01 base fare + taxes/fees. Set `maxPrice` to your preferred threshold.

## Troubleshooting

### "Not logged in" error
Run `pnpm dev`, go to http://localhost:3000/settings, and login again.

### Discord notifications not working
1. Verify webhook URL is correct
2. Check Discord webhook permissions
3. Check console for error messages

### Scans are slow
- Reduce number of destinations
- Use popular destinations mode
- Increase scan interval
