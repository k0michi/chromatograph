# Chromatograph

Chromatograph is a self-hostable CRDT paint application with a collaborative infinite canvas.

## Self-hosting

The easiest way to run Chromatograph is with Docker Compose.

Requirements:

- Docker Engine
- Docker Compose v2

Clone the repository and start the services:

```sh
git clone https://github.com/k0michi/chromatograph.git
cd chromatograph
docker compose up --build -d
```

Open [http://localhost](http://localhost) in a browser. Nginx serves the frontend on port 80 and proxies API and WebSocket traffic to the backend.

Canvas data and snapshots are stored in the `backend-data` and `backend-snapshots` Docker volumes. To stop the application without deleting its data:

```sh
docker compose down
```

For an internet-facing installation, place the service behind HTTPS or add TLS configuration to Nginx. Service Workers and other browser features require a secure context outside `localhost`.

## Development

The frontend and backend can be tested independently:

```sh
cd frontend
npm install
npm run typecheck
npm test
```

```sh
cd backend
swift test
```

## License

Chromatograph is available under the [MIT License](LICENSE).
