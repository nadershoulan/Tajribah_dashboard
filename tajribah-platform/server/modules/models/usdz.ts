/**
 * P1.13b — the iPhone file: a USDZ made from the plain (`native`) GLB, so Quick Look opens the
 * product in the shopper's room straight from the shop's button, at its true size, with no viewer
 * to download first (`widget/src/ar.ts`). Until now only a merchant who uploaded a USDZ had one.
 *
 * No tool on the server (the P1.13b question was which one to install): the scene is written as a
 * USD text layer with UsdPreviewSurface materials — the layer Quick Look reads, and what three.js's
 * USDZ exporter writes for `<model-viewer>`'s own Quick Look — and packed as USDZ: a zip whose files
 * are stored uncompressed, each starting on a 64-byte boundary, the layer first (Pixar's USDZ spec).
 *
 * What it carries, from glTF 2.0 metallic-roughness: the node hierarchy and its transforms; each
 * triangle primitive's points, normals and first UV set; base colour (factor and texture, alpha for
 * MASK and BLEND), metallic and roughness (factors and texture), normal map, occlusion, emissive.
 * Not carried: texture transforms, vertex colours, animation, skins, morph targets, points and
 * lines — none of which a product model in a room needs. glTF and USD agree on axes (Y up), units
 * (metres) and handedness, so nothing is converted but the UV's V (glTF counts it from the top).
 *
 * Pure: a document in, bytes out. `process.ts` stores it.
 */
import type { Document, Material, Node, Primitive, Texture, TextureInfo } from '@gltf-transform/core';

/** The layer's name inside the package, and where its textures go. */
const LAYER = 'model.usda';

export class UsdzError extends Error {}

type Entry = { name: string; data: Uint8Array };

export function toUsdz(doc: Document): Uint8Array {
  const writer = new UsdaWriter(doc);
  const layer = writer.layer();
  if (writer.meshes === 0) throw new UsdzError('the model has no triangles to show');
  return zipStored([{ name: LAYER, data: new TextEncoder().encode(layer) }, ...writer.textures]);
}

const WRAP: Record<number, string> = { 10497: 'repeat', 33071: 'clamp', 33648: 'mirror' };
const TRIANGLES = 4;

class UsdaWriter {
  readonly textures: Entry[] = [];
  meshes = 0;
  private readonly textureFiles = new Map<Texture, string>();
  /** One USD material per glTF material and whether its meshes have UVs (textures need them). */
  private readonly materialNames = new Map<string, string>();
  private readonly materialBlocks: string[] = [];

  constructor(private readonly doc: Document) {}

  layer(): string {
    const root = this.doc.getRoot();
    const scene = root.getDefaultScene() ?? root.listScenes()[0];
    if (!scene) throw new UsdzError('the model has no scene');
    const nodes = scene.listChildren().map((node, i) => this.node(node, `Node_${i}`, 1)).join('\n');
    return [
      '#usda 1.0',
      '(',
      '    customLayerData = {',
      '        string creator = "Tajribah"',
      '    }',
      '    defaultPrim = "Root"',
      '    metersPerUnit = 1',
      '    upAxis = "Y"',
      ')',
      '',
      'def Xform "Root" (',
      '    kind = "component"',
      ')',
      '{',
      nodes,
      '',
      '    def Scope "Materials"',
      '    {',
      this.materialBlocks.join('\n'),
      '    }',
      '}',
      '',
    ].join('\n');
  }

  private node(node: Node, name: string, depth: number): string {
    const pad = '    '.repeat(depth);
    const lines = [`${pad}def Xform "${name}"`, `${pad}{`];
    const m = node.getMatrix(); // column-major: its four columns are USD's four rows
    const isIdentity = m.every((v, i) => v === (i % 5 === 0 ? 1 : 0));
    if (!isIdentity) {
      const rows = [0, 4, 8, 12].map((r) => `(${[m[r]!, m[r + 1]!, m[r + 2]!, m[r + 3]!].map(num).join(', ')})`).join(', ');
      lines.push(`${pad}    matrix4d xformOp:transform = ( ${rows} )`, `${pad}    uniform token[] xformOpOrder = ["xformOp:transform"]`);
    }
    node.getMesh()?.listPrimitives().forEach((primitive, i) => {
      const mesh = this.mesh(primitive, `${name}_Mesh_${i}`, depth + 1);
      if (mesh) lines.push(mesh);
    });
    node.listChildren().forEach((child, i) => lines.push(this.node(child, `${name}_${i}`, depth + 1)));
    lines.push(`${pad}}`);
    return lines.join('\n');
  }

  private mesh(primitive: Primitive, name: string, depth: number): string | null {
    if (primitive.getMode() !== TRIANGLES) return null;
    const position = primitive.getAttribute('POSITION');
    if (!position || position.getCount() < 3) return null;
    const count = position.getCount();
    const indices = primitive.getIndices();
    const faceVertexIndices: number[] = indices ? Array.from({ length: indices.getCount() }, (_, i) => indices.getScalar(i)) : Array.from({ length: count }, (_, i) => i);
    const triangles = Math.floor(faceVertexIndices.length / 3);
    if (triangles === 0) return null;
    faceVertexIndices.length = triangles * 3;

    const el: number[] = [];
    const vec = (accessor: NonNullable<ReturnType<Primitive['getAttribute']>>, i: number, size: number) => accessor.getElement(i, el).slice(0, size);
    const points: string[] = [];
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
      const p = vec(position, i, 3);
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k]!, p[k]!); max[k] = Math.max(max[k]!, p[k]!); }
      points.push(`(${p.map(num).join(', ')})`);
    }
    const normal = primitive.getAttribute('NORMAL');
    const uv = primitive.getAttribute('TEXCOORD_0');
    const material = primitive.getMaterial();
    const pad = '    '.repeat(depth);
    const lines = [
      `${pad}def Mesh "${name}" (`,
      `${pad}    prepend apiSchemas = ["MaterialBindingAPI"]`,
      `${pad})`,
      `${pad}{`,
      `${pad}    float3[] extent = [(${min.map(num).join(', ')}), (${max.map(num).join(', ')})]`,
      `${pad}    int[] faceVertexCounts = [${new Array(triangles).fill(3).join(', ')}]`,
      `${pad}    int[] faceVertexIndices = [${faceVertexIndices.join(', ')}]`,
      `${pad}    rel material:binding = </Root/Materials/${this.material(material, uv !== null)}>`,
    ];
    if (normal?.getCount() === count) {
      const normals = Array.from({ length: count }, (_, i) => `(${vec(normal, i, 3).map(num).join(', ')})`);
      lines.push(`${pad}    normal3f[] normals = [${normals.join(', ')}] (`, `${pad}        interpolation = "vertex"`, `${pad}    )`);
    }
    lines.push(`${pad}    point3f[] points = [${points.join(', ')}]`);
    if (uv?.getCount() === count) {
      const st = Array.from({ length: count }, (_, i) => { const [u, v] = vec(uv, i, 2); return `(${num(u!)}, ${num(1 - v!)})`; });
      lines.push(`${pad}    texCoord2f[] primvars:st = [${st.join(', ')}] (`, `${pad}        interpolation = "vertex"`, `${pad}    )`);
    }
    lines.push(`${pad}    uniform bool doubleSided = ${material?.getDoubleSided() ? 1 : 0}`, `${pad}    uniform token subdivisionScheme = "none"`, `${pad}}`);
    this.meshes++;
    return lines.join('\n');
  }

  /** The material's prim name, written once. `hasUv`: textures need the mesh's UVs to mean anything. */
  private material(material: Material | null, hasUv: boolean): string {
    const key = `${material ? this.doc.getRoot().listMaterials().indexOf(material) : -1}:${hasUv}`;
    const known = this.materialNames.get(key);
    if (known) return known;
    const name = `Material_${this.materialNames.size}`;
    this.materialNames.set(key, name);
    const path = `/Root/Materials/${name}`;
    const shaders: string[] = [];
    const inputs: string[] = [];
    let reader = false;

    const texture = (info: TextureInfo | null, image: Texture | null, slot: string, colorSpace: 'sRGB' | 'raw', scale: number[], outputs: string[], bias?: number[]): string | null => {
      if (!hasUv || !image || !info) return null;
      const file = this.textureFile(image);
      if (!file) return null;
      reader = true;
      const shader = `Texture_${slot}`;
      shaders.push([
        `            def Shader "${shader}"`,
        '            {',
        '                uniform token info:id = "UsdUVTexture"',
        `                asset inputs:file = @${file}@`,
        `                float2 inputs:st.connect = <${path}/PrimvarReader_st.outputs:result>`,
        `                float4 inputs:scale = (${scale.map(num).join(', ')})`,
        ...(bias ? [`                float4 inputs:bias = (${bias.map(num).join(', ')})`] : []),
        `                token inputs:sourceColorSpace = "${colorSpace}"`,
        `                token inputs:wrapS = "${WRAP[info.getWrapS()] ?? 'repeat'}"`,
        `                token inputs:wrapT = "${WRAP[info.getWrapT()] ?? 'repeat'}"`,
        ...outputs.map((o) => `                ${o === 'rgb' ? 'float3' : 'float'} outputs:${o}`),
        '            }',
      ].join('\n'));
      return `${path}/${shader}`;
    };

    const base = material?.getBaseColorFactor() ?? [0.8, 0.8, 0.8, 1];
    const alphaMode = material?.getAlphaMode() ?? 'OPAQUE';
    const baseTex = texture(material?.getBaseColorTextureInfo() ?? null, material?.getBaseColorTexture() ?? null, 'base', 'sRGB', base, ['rgb', 'a']);
    inputs.push(baseTex ? `color3f inputs:diffuseColor.connect = <${baseTex}.outputs:rgb>` : `color3f inputs:diffuseColor = (${base.slice(0, 3).map(num).join(', ')})`);
    if (alphaMode !== 'OPAQUE') {
      inputs.push(baseTex ? `float inputs:opacity.connect = <${baseTex}.outputs:a>` : `float inputs:opacity = ${num(base[3]!)}`);
      if (alphaMode === 'MASK') inputs.push(`float inputs:opacityThreshold = ${num(material?.getAlphaCutoff() ?? 0.5)}`);
    }

    const metallic = material?.getMetallicFactor() ?? 1;
    const roughness = material?.getRoughnessFactor() ?? 1;
    const mrTex = texture(material?.getMetallicRoughnessTextureInfo() ?? null, material?.getMetallicRoughnessTexture() ?? null, 'mr', 'raw', [1, roughness, metallic, 1], ['g', 'b']);
    inputs.push(mrTex ? `float inputs:metallic.connect = <${mrTex}.outputs:b>` : `float inputs:metallic = ${num(metallic)}`);
    inputs.push(mrTex ? `float inputs:roughness.connect = <${mrTex}.outputs:g>` : `float inputs:roughness = ${num(roughness)}`);

    const ns = material?.getNormalScale() ?? 1;
    const normalTex = texture(material?.getNormalTextureInfo() ?? null, material?.getNormalTexture() ?? null, 'normal', 'raw', [2 * ns, 2 * ns, 2, 1], ['rgb'], [-ns, -ns, -1, 0]);
    if (normalTex) inputs.push(`normal3f inputs:normal.connect = <${normalTex}.outputs:rgb>`);

    const occlusionTex = texture(material?.getOcclusionTextureInfo() ?? null, material?.getOcclusionTexture() ?? null, 'occlusion', 'raw', [1, 1, 1, 1], ['r']);
    if (occlusionTex) inputs.push(`float inputs:occlusion.connect = <${occlusionTex}.outputs:r>`);

    const emissive = material?.getEmissiveFactor() ?? [0, 0, 0];
    const emissiveTex = emissive.some((v) => v > 0)
      ? texture(material?.getEmissiveTextureInfo() ?? null, material?.getEmissiveTexture() ?? null, 'emissive', 'sRGB', [...emissive, 1], ['rgb'])
      : null;
    inputs.push(emissiveTex ? `color3f inputs:emissiveColor.connect = <${emissiveTex}.outputs:rgb>` : `color3f inputs:emissiveColor = (${emissive.map(num).join(', ')})`);

    if (reader) {
      shaders.unshift([
        '            def Shader "PrimvarReader_st"',
        '            {',
        '                uniform token info:id = "UsdPrimvarReader_float2"',
        '                string inputs:varname = "st"',
        '                float2 inputs:fallback = (0, 0)',
        '                float2 outputs:result',
        '            }',
      ].join('\n'));
    }
    this.materialBlocks.push([
      `        def Material "${name}"`,
      '        {',
      `            token outputs:surface.connect = <${path}/PreviewSurface.outputs:surface>`,
      '',
      '            def Shader "PreviewSurface"',
      '            {',
      '                uniform token info:id = "UsdPreviewSurface"',
      '                int inputs:useSpecularWorkflow = 0',
      ...inputs.map((line) => `                ${line}`),
      '                token outputs:surface',
      '            }',
      ...shaders,
      '        }',
    ].join('\n'));
    return name;
  }

  /** The texture's path in the package, written once; null for a format Quick Look cannot read. */
  private textureFile(texture: Texture): string | null {
    const known = this.textureFiles.get(texture);
    if (known !== undefined) return known;
    const image = texture.getImage();
    const mime = texture.getMimeType();
    const ext = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : null;
    if (!image || !ext) return null;
    const file = `textures/Texture_${this.textureFiles.size}.${ext}`;
    this.textureFiles.set(texture, file);
    this.textures.push({ name: file, data: image });
    return file;
  }
}

/** A number as USD text: finite, at most six decimals (a micrometre for positions). `String(-0)` is "0". */
function num(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 1e6) / 1e6);
}

// ── USDZ packaging: a zip, every file stored as it is and starting on a 64-byte boundary. ─────────

const ALIGN = 64;
const PADDING_HEADER = 0x1986; // the extra-field id Pixar's own writer uses for this padding

export function zipStored(entries: readonly Entry[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.data);
    const headerLength = 30 + name.length;
    let extra = (ALIGN - ((offset + headerLength + 4) % ALIGN)) % ALIGN; // after a 4-byte extra-field header
    const extraField = new Uint8Array(4 + extra);
    const ev = new DataView(extraField.buffer);
    ev.setUint16(0, PADDING_HEADER, true);
    ev.setUint16(2, extra, true);
    extra += 4;
    const local = new Uint8Array(headerLength);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, 0, true); // time
    lv.setUint16(12, 0x21, true); // date: 1980-01-01, so the same model always makes the same bytes
    lv.setUint32(14, crc, true);
    lv.setUint32(18, entry.data.byteLength, true);
    lv.setUint32(22, entry.data.byteLength, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, extra, true);
    local.set(name, 30);
    chunks.push(local, extraField, entry.data);

    const record = new Uint8Array(46 + name.length);
    const cv = new DataView(record.buffer);
    cv.setUint32(0, 0x02014b50, true); // central directory header
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, entry.data.byteLength, true);
    cv.setUint32(24, entry.data.byteLength, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    record.set(name, 46);
    central.push(record);
    offset += headerLength + extra + entry.data.byteLength;
  }
  const centralSize = central.reduce((n, c) => n + c.byteLength, 0);
  const end = new Uint8Array(22);
  const dv = new DataView(end.buffer);
  dv.setUint32(0, 0x06054b50, true); // end of central directory
  dv.setUint16(8, entries.length, true);
  dv.setUint16(10, entries.length, true);
  dv.setUint32(12, centralSize, true);
  dv.setUint32(16, offset, true);
  const parts = [...chunks, ...central, end];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.byteLength; }
  return out;
}

let table: Uint32Array | null = null;
export function crc32(data: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
