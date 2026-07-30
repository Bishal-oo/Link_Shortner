
FROM node:22-alpine AS build

WORKDIR /app

# Copy ONLY the manifests first. This layer is cached and only re-runs when
# package.json / package-lock.json change — not when you edit source code.
COPY package*.json ./

# npm ci = clean, reproducible install from package-lock.json (installs ALL
# deps here, including devDeps like typescript, because we need them to build).
RUN npm ci

# Now copy the rest and compile. Editing source invalidates from here down,
# but the (slow) install layer above stays cached.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build   # tsc -> dist/

# =============================================================================
# Stage 2 — RUNTIME: a lean image with only what's needed to RUN the app.
# =============================================================================
FROM node:22-alpine AS runtime

WORKDIR /app

# Signals to libraries (and our own code) that this is production.
ENV NODE_ENV=production

COPY package*.json ./

# --omit=dev = install ONLY production dependencies. No TypeScript, no Jest,
# no test tooling ships in the final image.
RUN npm ci --omit=dev

# Copy the compiled output from the build stage. The source .ts never comes.
COPY --from=build /app/dist ./dist

# Run as the built-in non-root "node" user — a container that gets compromised
# shouldn't be running as root.
USER node

# Documents the port the app listens on (doesn't publish it — compose does that).
EXPOSE 3000

CMD ["node", "dist/index.js"]
