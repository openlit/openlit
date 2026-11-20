import openlit from 'openlit';

openlit.init({ applicationName: 'edge-test', otlpEndpoint: globalThis.OTLP_ENDPOINT });

globalThis.runEdge = async () => {
  await openlit.trace('request', async () => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    await openlit.llm({ provider: 'custom', model: 'private-model' }, async (span) => {
      span.setUsage({ inputTokens: 10, outputTokens: 5 });
    });
  });
  await openlit.flush();
};
