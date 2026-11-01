# Nimbus Cluster

Nimbus Cluster is an interactive distributed-systems laboratory built with Next.js, React, Node.js, TypeScript, and PostgreSQL. It simulates a five-node cluster and provides visual demonstrations of common distributed-systems concepts without requiring multiple physical machines.

## Live deployment

- Application: https://nimbus-cluster.onrender.com
- Health check: https://nimbus-cluster.onrender.com/api/health
- Source repository: https://github.com/harshitaak7/Nimbus-Cluster

The deployed health endpoint returns `database: "ready"` when the Render service can connect to PostgreSQL and the application tables are available.

## What the project demonstrates

The application includes separate interactive pages for:

- **Cluster overview** - simulated node status, events, traffic, and cluster statistics.
- **Messaging** - point-to-point and broadcast message delivery between nodes.
- **Load balancing** - round-robin worker selection and node distribution.
- **Logical clocks** - Lamport-style logical clock activity across nodes.
- **Mutex** - distributed mutual-exclusion request and lock behaviour.
- **Deadlock** - resource allocation and deadlock detection scenarios.
- **MapReduce** - mapper, shuffle, reducer, combiner, worker failure, and retry simulations.
- **Distributed files** - uploads, text-file creation, checksums, replication, downloads from live replicas, replica repair, and deletion.

XML-RPC and Java RMI were intentionally removed. The current project focuses on the active cluster, messaging, coordination, MapReduce, and replicated-file demonstrations.

## Technology stack

- Next.js 16
- React 19
- TypeScript 5
- Node.js
- PostgreSQL
- Drizzle ORM
- Tailwind CSS
- ESLint

The cluster engine is an in-memory simulation running in the Node.js process. The PostgreSQL database stores distributed files and MapReduce job history. Cluster state and simulated node failures reset when the service restarts or redeploys.

## Project structure

```text
src/
  app/
    page.tsx                 Cluster dashboard
    messaging/               Messaging demonstration
    balancer/                Load-balancing demonstration
    clocks/                  Logical-clock demonstration
    mutex/                   Distributed mutex demonstration
    deadlock/                Deadlock demonstration
    mapreduce/               MapReduce demonstration
    files/                   Replicated file-sharing demonstration
    api/
      dc/                    Cluster snapshot and actions
      files/                 File listing, upload, repair, and creation
      mapreduce/             MapReduce history and job execution
      health/                Liveness and database health check
  components/                Shared shell, UI, and cluster provider
  db/                        PostgreSQL pool and Drizzle schema
  lib/engine/                Cluster, actions, files, and MapReduce engines
demo-files/                  Sample files seeded into the file store
```

## Demo files

The `demo-files/` directory contains:

- `cluster-readme.txt` - a small distributed-file example
- `nodes.csv` - sample node metadata
- `mapreduce-input.txt` - sample text for MapReduce

These files are automatically seeded into PostgreSQL when the file engine initializes an empty database.

## Requirements

- Node.js 20 or newer
- npm
- PostgreSQL for database-backed features

## Run locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a local environment file named `.env.local`:

   ```env
   DATABASE_URL=postgresql://postgres:password@localhost:5432/nimbuscluster
   ```

3. Start the development server:

   ```bash
   npm run dev
   ```

4. Open http://localhost:3000.

The database tables are created automatically when the health endpoint or a database-backed feature is first used. Visit http://localhost:3000/api/health to confirm the connection.

## npm scripts

```bash
npm run dev       # Start the development server
npm run build     # Create a production build
npm start         # Start the production server
npm run lint      # Run ESLint
npm run typecheck # Run the TypeScript compiler without emitting files
```

Before submitting changes, run:

```bash
npm run lint
npm run typecheck
npm run build
```

## API reference

### Health

```text
GET /api/health
```

Returns a liveness response and database state:

```json
{ "ok": true, "database": "ready" }
```

Possible database states are `ready`, `unavailable`, or `not configured`. The endpoint remains HTTP 200 so Render can use it as a process health check.

### Cluster

```text
GET  /api/dc
POST /api/dc
```

`GET` returns the current simulated cluster snapshot. `POST` accepts an action and optional payload:

```json
{
  "action": "node-failure",
  "payload": { "nodeId": "node-2" }
}
```

The available actions are exposed by the controls in the dashboard.

### Files

```text
GET    /api/files
POST   /api/files
GET    /api/files/:id
GET    /api/files/:id?text=1
DELETE /api/files/:id
```

`POST /api/files` accepts either a multipart upload with a `file` field or JSON text-file creation:

```json
{
  "name": "example.txt",
  "content": "Hello from Nimbus Cluster",
  "copies": 2
}
```

Use the repair action to restore missing replicas:

```json
{ "action": "repair" }
```

### MapReduce

```text
GET  /api/mapreduce
POST /api/mapreduce
```

The POST endpoint accepts a job definition containing `job`, `text`, optional mapper/reducer counts, `combiner`, `pattern`, and an optional worker to fail. Completed jobs are stored in the `mr_jobs` PostgreSQL table.

## Database

The database schema is defined in `src/db/schema.ts`:

- `dc_files` stores file metadata, base64 content, checksums, replica lists, replication targets, and download counts.
- `mr_jobs` stores MapReduce job history and summary data.

The application creates these tables on first database-backed request. Do not commit `.env`, `.env.local`, passwords, or connection strings to GitHub.

## Deploy on Render

1. Create a Render PostgreSQL database.
2. Create a Render Web Service connected to this GitHub repository.
3. Configure:

   ```text
   Build Command: npm install && npm run build
   Start Command: npm start
   Health Check Path: /api/health
   ```

4. Add the environment variable:

   ```text
   DATABASE_URL=<Render internal PostgreSQL connection string>
   ```

5. Deploy the service and verify:

   ```text
   https://your-service.onrender.com/api/health
   ```

Use the Render internal database URL when the database and web service are in the same Render region. If a database credential has been exposed, rotate the password and update `DATABASE_URL`.

## Important limitations

- This is an educational simulator, not a production distributed database.
- Node networking and worker behaviour are simulated in one Node.js service.
- In-memory cluster state is not persistent across restarts or deployments.
- PostgreSQL persistence is used for files and MapReduce history.
- Authentication, authorization, multi-user isolation, and production file object storage are not included.

## License

This project is intended for educational and laboratory use.
