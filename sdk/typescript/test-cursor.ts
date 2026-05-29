import openlit from './src/index';
import { Agent } from '@cursor/sdk';

async function main() {
  openlit.init({
    captureMessageContent: true,
  });

  console.log('--- Agent.create() + agent.send() + stream ---');
  const agent = await Agent.create({
    apiKey: process.env.CURSOR_API_KEY!,
    model: { id: 'composer-2' },
    local: { cwd: process.cwd() },
  });

  const run = await agent.send('What is 2 + 2? Reply in one word.');

  for await (const event of run.stream()) {
    if (event.type === 'assistant') {
      for (const block of event.message.content) {
        if (block.type === 'text') process.stdout.write(block.text);
      }
    } else if (event.type === 'tool_call') {
      console.log(`[tool] ${event.name} (${event.status})`);
    }
  }
  console.log('\n');

  console.log('--- Agent.prompt() one-shot ---');
  const result = await Agent.prompt('What is 3 + 3? Reply in one word.', {
    apiKey: process.env.CURSOR_API_KEY!,
    model: { id: 'composer-2' },
    local: { cwd: process.cwd() },
  });
  console.log('Result:', result.result);
  console.log('Status:', result.status);

  agent.close();

  // Give the OTel exporter time to flush spans
  await new Promise(resolve => setTimeout(resolve, 5000));
  console.log('\nDone. Check your OTel collector for spans.');
}

main().catch(console.error);
