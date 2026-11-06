import { WorkerEntrypoint } from 'cloudflare:workers';
import openlit from 'openlit';

class App extends WorkerEntrypoint {
  helper() {
    return new Response('helped');
  }

  async fetch() {
    return this.helper();
  }
}

export default openlit.withWorker(App);
