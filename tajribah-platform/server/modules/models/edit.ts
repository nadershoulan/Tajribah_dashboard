/**
 * P3.8 — the 3D editor's server side: the merchant's own view of a version's file, and an edit
 * that becomes a new version.
 *
 * An edit is **baked into the file**, never kept as a viewing setting: iPhone Quick Look and
 * Android Scene Viewer open the file itself, so a turn that only the in-page viewer knew about
 * would leave the native AR showing the model on its side. So an edit:
 *   1. reads the version's **original** upload (not the optimised copy: no compounding losses),
 *   2. turns it in 90° steps (`rotate`) and/or fits it to the product's measurements (`fit`,
 *      P3.5's `fitToProduct`), then stands it on the floor, centred,
 *   3. goes in as the model's next version through the same path as an upload — checked,
 *      processed, never live until published, and (a generated model) reviewed again (T25).
 */
import { eq } from 'drizzle-orm';
import { Document, WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { center } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { modelFiles, models3d, modelVersions, products } from '@/db/schema';
import { errors } from '@/server/core/errors/problem';
import { forTenant } from '@/server/core/storage/storage';
import type { TenantContext } from '@/server/core/tenancy/context';
import { turnQuaternion, type Turn } from '@/lib/model-turn';
import { fileFor } from './files';
import { fitToProduct, type ProductSize } from './postprocess';
import { confirmUpload, startUpload } from './service';

export type ModelEdit = { fromVersionId: string; rotate?: { x?: Turn; y?: Turn; z?: Turn }; fit?: boolean };

const TURNS: readonly number[] = [0, 90, 180, 270];

async function io(): Promise<WebIO> {
  await MeshoptDecoder.ready;
  return new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
}

/** Turn the whole scene about its origin, in place. */
export function turnScene(doc: Document, rotate: { x?: number; y?: number; z?: number }): void {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) return;
  const node = doc.createNode('tajribah-turn').setRotation(turnQuaternion(rotate.x ?? 0, rotate.y ?? 0, rotate.z ?? 0));
  for (const child of [...scene.listChildren()]) { scene.removeChild(child); node.addChild(child); }
  scene.addChild(node);
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** API-055 — a version's web file for the editor's viewer (the merchant's own model, any state it has one). */
export async function modelFileFor(ctx: TenantContext, versionId: string): Promise<{ body: ReadableStream; size: number }> {
  ctx.require('models:read');
  const version = await ctx.db.findById(modelVersions, versionId);
  if (!version) throw errors.notFound('model version');
  const files = await ctx.db.find(modelFiles, eq(modelFiles.modelVersionId, versionId), { limit: 10 });
  const web = fileFor(files, 'web');
  if (!web || web.bytesDeletedAt) throw errors.notFound('model file');
  const object = await forTenant(ctx.tenantId).get(web.storageKey);
  if (!object) throw errors.notFound('model file');
  return { body: object.body, size: object.meta.size };
}

/** API-056 — turn and/or fit a ready version; the result is the model's next version, processing. */
export async function editModel(ctx: TenantContext, modelId: string, edit: ModelEdit): Promise<{ versionId: string; version: number }> {
  ctx.require('models:write');
  const turn = { x: edit.rotate?.x ?? 0, y: edit.rotate?.y ?? 0, z: edit.rotate?.z ?? 0 };
  if (![turn.x, turn.y, turn.z].every((v) => TURNS.includes(v))) throw errors.validation({ rotate: ['turns are 0, 90, 180 or 270 degrees'] });
  const turned = turn.x !== 0 || turn.y !== 0 || turn.z !== 0;
  if (!turned && !edit.fit) throw errors.validation({ rotate: ['nothing to change: turn the model or fit it to the product'] });

  const model = await ctx.db.findById(models3d, modelId);
  if (!model) throw errors.notFound('model');
  const from = await ctx.db.findById(modelVersions, edit.fromVersionId);
  if (!from || from.modelId !== modelId) throw errors.notFound('model version');
  if (from.status !== 'ready') throw errors.conflict(`version ${from.version} is ${from.status} — only a ready version can be edited`);
  const files = await ctx.db.find(modelFiles, eq(modelFiles.modelVersionId, from.id), { limit: 10 });
  const original = fileFor(files, 'original');
  if (!original || original.format !== 'glb' || original.bytesDeletedAt) throw errors.conflict('this version has no GLB to edit (a USDZ is edited in the tool that made it)');

  let size: ProductSize | null = null;
  if (edit.fit) {
    const product = model.productId ? await ctx.db.findById(products, model.productId) : null;
    size = (product?.dimensions as ProductSize | null | undefined) ?? null;
    if (!size || ![size.widthMm, size.heightMm, size.depthMm].some((v) => typeof v === 'number' && v > 0)) {
      throw errors.conflict('the product has no measurements to fit to — add its width and height first');
    }
  }

  const store = forTenant(ctx.tenantId);
  const object = await store.get(original.storageKey);
  if (!object) throw errors.conflict('the uploaded file is no longer in storage');
  const doc = await (await io()).readBinary(await readAll(object.body));
  if (turned) turnScene(doc, turn);
  if (size) await fitToProduct(doc, size); // stands it on the floor too
  else await doc.transform(center({ pivot: 'below' })); // a turned model must not sink into the floor
  const bytes = await (await io()).writeBinary(doc);

  const name = (original.originalFilename ?? 'model.glb').replace(/\.glb$/i, '');
  // The upload path, with us as the browser: the new version's file row names where the bytes go.
  const started = await startUpload(ctx, { filename: `${name}-edited.glb`, sizeBytes: bytes.byteLength, modelId });
  const target = fileFor(await ctx.db.find(modelFiles, eq(modelFiles.modelVersionId, started.versionId), { limit: 5 }), 'original');
  await store.put(target!.storageKey, bytes.slice().buffer as ArrayBuffer, { contentType: 'model/gltf-binary' });
  await confirmUpload(ctx, started.versionId);
  return { versionId: started.versionId, version: started.version };
}
