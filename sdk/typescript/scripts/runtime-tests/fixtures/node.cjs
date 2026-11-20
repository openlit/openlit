const openlit = require('openlit').default;

openlit.init({
  applicationName: 'node-test',
  otlpEndpoint: process.env.OTLP_ENDPOINT,
  disableMetrics: true,
  disableEvents: true,
});

(async () => {
  await openlit.trace('request', async () => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    await openlit.llm({ provider: 'custom', model: 'private-model' }, async (span) => {
      span.setUsage({ inputTokens: 10, outputTokens: 5 });
    });
  });
  // The process exits here, long before the batch timer: spans must be out by now.
  await openlit.flush();
  process.exit(0);
})();
