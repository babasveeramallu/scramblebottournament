# ScrabbleBot starter

This folder contains the bot client. The strategy in `src/strategy.ts` bids
conservatively, favors useful letters, and chooses the playable word with the
highest immediate score using the game's letter values and length multipliers.

## Setup on Windows

Install the SpacetimeDB CLI once from PowerShell, then open a new terminal so
the updated `PATH` is available:

```powershell
iwr https://windows.spacetimedb.com -useb | iex
```

From this directory, install the bot dependencies and generate the client
bindings:

```powershell
npm install
npm run generate
```

Create a team and bot on [scrabblebot.spacetimedb.com/team](https://scrabblebot.spacetimedb.com/team)
and generate a token there. Set `BOT_NAME` to the exact registered bot name.
On the first run, supply `BOT_TOKEN` locally; the bot saves it to an ignored
`.token-<BOT_NAME>` file for later runs.

```powershell
$env:BOT_NAME = "EXACT_REGISTERED_NAME"
$env:BOT_TOKEN = "YOUR_TOKEN"
npm start
```

To enter the tournament shown in the announcement, set its tournament ID before
starting the bot:

```powershell
$env:TOURNAMENT_ID = "2"
npm start
```

Keep tokens out of source files, commits, and chat. The tournament registration
request is made by the bot when it connects.

## Checks

```powershell
npm test
npm run build
```
