import { Value } from '@sinclair/typebox/value';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AuthError } from '../auth/service.js';
import { ApplicationService } from './service.js';
import { ManifestSchema, RequestSchema, APPLICATION_CONTRACT } from './contract.js';
const params = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: {
    id: {
      type: 'string',
      pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$',
    },
  },
};
export function applicationRoutes(
  app: FastifyInstance,
  service: ApplicationService,
  owner: (request: FastifyRequest) => Promise<string>,
  projectExists: (framework: string, project: string) => Promise<boolean>,
) {
  const ownedApplication = async (r: FastifyRequest, id: string) => {
    const ownerId = await owner(r);
    const registration = await service.registration(id);
    if (registration.owner_id !== ownerId) throw new AuthError('APPLICATION_NOT_FOUND',404,'Application not found');
  };
  app.addHook('onSend',async(request,reply,payload)=>{
    if(request.routeOptions.url?.startsWith('/api/v1/application'))reply.header('cache-control','no-store');
    return payload;
  });
  app.delete<{Params:{id:string}}>('/api/v1/applications/:id',{schema:{params}},async(r,reply)=>{await ownedApplication(r,r.params.id);await service.revoke(r.params.id);return reply.code(202).send({admissionRevoked:true,inFlightEffectsRequireReconciliation:true});});
  const principal = (r: FastifyRequest) => {
    if (r.headers.cookie || r.headers.origin)
      throw new AuthError(
        'APPLICATION_BACKEND_ONLY',
        403,
        'Only the trusted application backend may use service credentials',
      );
    return service.store.authorize(r.headers.authorization);
  };
  app.post('/api/v1/applications', { schema: { body: ManifestSchema }, preValidation: async (r) => { if (!Value.Check(ManifestSchema, r.body)) throw new AuthError('APPLICATION_MANIFEST_INVALID',422,'Manifest violates the versioned contract'); } }, async (r, reply) => {
    const id = await owner(r);
    return reply.code(201).send(await service.register(id, r.body, projectExists));
  });
  app.post<{ Params: { id: string }; Body: { ttlSeconds: number } }>(
    '/api/v1/applications/:id/credentials',
    {
      schema: {
        params,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['ttlSeconds'],
          properties: { ttlSeconds: { type: 'integer', minimum: 60, maximum: 86400 } },
        },
      },
    },
    async (r, reply) => {
      await ownedApplication(r,r.params.id);
      return reply.code(201).send(await service.store.credential(r.params.id, r.body.ttlSeconds));
    },
  );
  app.delete<{ Params: { id: string; credentialId: string } }>(
    '/api/v1/applications/:id/credentials/:credentialId',
    async (r, reply) => {
      await ownedApplication(r,r.params.id);
      return reply
        .code(
          (await service.store.revokeCredential(r.params.id, r.params.credentialId)) ? 204 : 404,
        )
        .send();
    },
  );
  app.post(
    '/api/v1/application/requests',
    { schema: { body: RequestSchema }, preValidation: async (r) => { if (!Value.Check(RequestSchema, r.body)) throw new AuthError('APPLICATION_REQUEST_INVALID',422,'Request violates the versioned contract'); } },
    async (r, reply) => {
      const a = await principal(r);
      const result = await service.accept(a, r.headers['idempotency-key'], r.body);
      return reply
        .code(result.replayed ? 200 : 202)
        .send({ contractVersion: APPLICATION_CONTRACT, ...result });
    },
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/application/requests/:id',
    { schema: { params } },
    async (r) => {
      const a = await principal(r);
      return {
        contractVersion: APPLICATION_CONTRACT,
        receipt: await service.store.get(a.id, r.params.id),
        delivery: await service.delivery(a.id, r.params.id),
      };
    },
  );
  app.post<{ Params: { id: string } }>(
    '/api/v1/application/requests/:id/cancel',
    { schema: { params } },
    async (r, reply) => {
      const a = await principal(r);
      return reply
        .code(202)
        .send({ receipt: await service.store.cancel(a.id, r.params.id), effectsSettled: false });
    },
  );
  app.post<{ Params: { id: string } }>(
    '/api/v1/application/requests/:id/retry-delivery',
    { schema: { params } },
    async (r, reply) => {
      const a = await principal(r);
      return reply
        .code((await service.retryDelivery(a.id, r.params.id)) ? 202 : 409)
        .send({ inferenceRepeated: false });
    },
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/application/requests/:id/export',
    { schema: { params } },
    async (r) => {
      const a = await principal(r);
      return {
        contractVersion: APPLICATION_CONTRACT,
        receipt: await service.store.get(a.id, r.params.id),
        delivery: await service.delivery(a.id, r.params.id),
      };
    },
  );
  app.delete<{ Params: { id: string } }>(
    '/api/v1/application/requests/:id',
    { schema: { params } },
    async (r, reply) => {
      const a = await principal(r);
      return reply
        .code(202)
        .send({
          receipt: await service.requestErase(a.id, r.params.id),
          applicationStoreDeletionRequired: true,
          backupExpiryDays: null,
        backupPolicy: 'operator-managed; expiry not verified',
        });
    },
  );
}
