/** A shader failed to compile or a program failed to link; `log` holds the driver's info log. */
export class PollyrollShaderError extends Error {
  readonly log: string;
  constructor(message: string, log: string) {
    super(message);
    this.name = 'PollyrollShaderError';
    this.log = log;
  }
}

function compile(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new PollyrollShaderError('cannot create shader', '');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new PollyrollShaderError('shader compile failed', log);
  }
  return shader;
}

/** Compiles and links a program; shaders are deleted right after linking. Throws PollyrollShaderError. */
export function createProgram(
  gl: WebGL2RenderingContext,
  vertex: string,
  fragment: string,
): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vertex);
  let fs: WebGLShader;
  try {
    fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  } catch (error) {
    gl.deleteShader(vs);
    throw error;
  }
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.detachShader(program, vs);
  gl.detachShader(program, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? '';
    gl.deleteProgram(program);
    throw new PollyrollShaderError('shader link failed', log);
  }
  return program;
}

/** ARRAY_BUFFER filled with `data`, or `data` bytes reserved for DYNAMIC_DRAW updates. */
export function createBuffer(gl: WebGL2RenderingContext, data: Float32Array | number): WebGLBuffer {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  if (typeof data === 'number') gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  else gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buffer;
}

/** Float attribute from the bound ARRAY_BUFFER (strides and offsets in floats). */
export function attrib(
  gl: WebGL2RenderingContext,
  location: number,
  size: number,
  stride: number,
  offset: number,
  divisor: number,
): void {
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride * 4, offset * 4);
  gl.vertexAttribDivisor(location, divisor);
}
