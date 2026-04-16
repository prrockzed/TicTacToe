FROM registry.heroiclabs.com/heroiclabs/nakama:3.22.0

# Copy compiled TypeScript runtime
COPY build/         /nakama/data/build/

# Copy production Nakama config
COPY production.yml /nakama/data/production.yml

# Copy startup script
COPY entrypoint.sh  /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 7350

ENTRYPOINT ["/entrypoint.sh"]
