```shell
docker run --gpus all \
    -e OTEL_EXPORTER_OTLP_ENDPOINT="https://otlp-gateway-prod-us-east-0.grafana.net/otlp" \
    -e OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic%20OTUyMzIyOmdsY19leUp2SWpvaU5qVXlPVGt5SWl3aWJpSTZJbk4wWVdOckxUazFNak15TWkxdmRHeHdMWGR5YVhSbExXRnpaQ0lzSW1zaU9pSTNlakF6TVZNeWNGWlZWamxHY1hwNk5qSXhkemxJV0dRaUxDSnRJanA3SW5JaU9pSndjbTlrTFhWekxXVmhjM1F0TUNKOWZRPT0=" \
    otel-gpu-monitor
```