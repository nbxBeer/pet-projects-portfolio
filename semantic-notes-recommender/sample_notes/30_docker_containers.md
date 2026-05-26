# Docker and Containers

Containers package an application with all its dependencies into an isolated, portable unit. Unlike virtual machines, containers share the host OS kernel, making them lightweight and fast to start.

## Images and layers

A Docker image is built from a series of read-only layers defined in a `Dockerfile`. Each instruction (`RUN`, `COPY`, `ADD`) creates a new layer. Layers are cached and reused across builds, speeding up rebuilds when only later instructions change.

## Key commands

```
docker build -t myapp .          # build an image from Dockerfile
docker run -p 8080:80 myapp      # run a container, map port 80 to 8080
docker exec -it <id> bash        # open a shell inside a running container
docker logs <id>                 # stream container stdout/stderr
```

## Container orchestration

Kubernetes schedules and manages containers across a cluster of nodes. It handles service discovery, rolling updates, horizontal scaling, and self-healing when containers crash.

## Networking

Containers communicate through virtual networks. Bridge networks isolate containers on the same host. Overlay networks span multiple hosts in a Swarm or Kubernetes cluster.

## Volumes

Volumes persist data outside the container filesystem, surviving container restarts and replacements. Bind mounts attach host directories directly into the container.
