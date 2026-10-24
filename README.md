# LinkUp — Node.js ephemeral stranger chat

A category-based chat starter with a Node.js + Express server and WebSockets (`ws`). Chat messages are relayed between the two users and are not written to a database or file by this application.

## Requirements
- Node.js 20 or newer
- npm

## Run locally
1. Extract the ZIP.
2. Open a terminal in the project folder.
3. Run `npm install`
4. Run `npm start`
5. Open http://localhost:3000 in two different browser sessions/devices on the same network (for another device, use the computer's LAN IP and allow the port through your firewall).

Choose the same category in both sessions to match and chat. When several people are waiting in one category, the server randomly chooses an eligible waiting partner from that category.

## Categories
Friends, Hackathon partner, Room partner, Gaming teammate, Relationship talk, Project teammate.

## Data handling
- Chat messages exist in server RAM only and disappear when the room is removed or the server restarts.
- Matching queues and room membership also exist in RAM.
- This application does not intentionally save chat messages to a database or local files.
- Hosting providers, reverse proxies, operating systems, and network infrastructure may keep access/security logs. Do not promise “zero data retention.”
- The simple demo has no accounts, persistent profiles, moderation team, or durable reporting. The report button only exits the chat.
- Restarting the server clears all in-memory queues and rooms.

## Before public deployment
This is a prototype. Add TLS/HTTPS (which enables secure WebSockets), robust rate limiting per IP/session, abuse prevention, block/skip, moderation and reporting, monitoring, connection limits, and production-tested matching logic. The room matching is intentionally simple and can be improved for high concurrency. Do not collect precise home addresses or other unnecessary personal data. Avoid romantic matching for minors; use age-appropriate safeguards and clear community rules.
