import { initGeometry } from '../geometry/kernel';
import { optimize } from './nest';
import type { OptimizationRequest, WorkerResponse } from '../domain/types';

self.onmessage = async (event: MessageEvent<OptimizationRequest>) => {
  const request = event.data;
  const send = (message: WorkerResponse) => self.postMessage(message);
  try {
    await initGeometry();
    const result = await optimize(request, (result) => send({ type: 'progress', result }));
    send({ type: 'done', result });
  } catch (error) {
    send({
      type: 'error',
      runId: request.runId,
      revision: request.revision,
      message: error instanceof Error ? error.message : 'Geometrieberechnung fehlgeschlagen.',
    });
  }
};
