import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../env.js';

/**
 * Convierte un buffer .mpp a XML usando MPXJ (Java).
 * Requiere:
 * - Java 17+ instalado y en PATH (o env.JAVA_BIN)
 * - MPXJ_LIB_PATH apuntando a carpeta con jars (mpxj.jar + dependencias)
 */

// Class names probados en orden · MPXJ cambió package en v13+
const MPXJ_MAIN_CLASSES = [
  'org.mpxj.sample.MpxjConvert',     // v13.x+ (nuevo)
  'net.sf.mpxj.sample.MpxjConvert',  // v12.x y anteriores
  'org.mpxj.MpxjConvert',
  'net.sf.mpxj.MpxjConvert',
];

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function runJava(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(env.JAVA_BIN, args);
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => (stdout += d.toString()));
    proc.stderr?.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (err) => resolve({ stdout, stderr: stderr + err.message, code: 1 }));
    proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });
}

export async function convertMppToXml(buffer: Buffer): Promise<string> {
  if (!env.MPXJ_LIB_PATH) {
    throw new Error('MPXJ_LIB_PATH no configurado en .env');
  }

  const sessionId = randomUUID();
  const tmpDir = await mkdtemp(path.join(tmpdir(), `mpxj-${sessionId}-`));
  const inFile = path.join(tmpDir, 'input.mpp');
  const outFile = path.join(tmpDir, 'output.xml');

  try {
    await writeFile(inFile, buffer);

    // Detectar estructura: si MPXJ_LIB_PATH contiene mpxj.jar al root + carpeta lib/,
    // necesitamos AMBOS en classpath. Si solo hay lib/, ese alcanza.
    const sep = process.platform === 'win32' ? ';' : ':';
    const rootJar = path.join(env.MPXJ_LIB_PATH, '*');
    const libJars = path.join(env.MPXJ_LIB_PATH, 'lib', '*');
    const classpath = `${rootJar}${sep}${libJars}`;

    // Intentar 1: si existe mpxjconvert.bat (Win) o mpxjconvert.sh (Unix), usarlo
    const isWin = process.platform === 'win32';
    const scriptName = isWin ? 'mpxjconvert.bat' : 'mpxjconvert.sh';
    const scriptCandidates = [
      path.join(env.MPXJ_LIB_PATH, scriptName),
      path.join(env.MPXJ_LIB_PATH, 'script', scriptName),
      path.join(env.MPXJ_LIB_PATH, 'bin', scriptName),
      path.join(env.MPXJ_LIB_PATH, '..', scriptName),
    ];
    let scriptPath: string | null = null;
    for (const c of scriptCandidates) {
      if (await fileExists(c)) {
        scriptPath = c;
        break;
      }
    }

    if (scriptPath) {
      // Ejecutar el script directamente (más portable, maneja classpath solo)
      const result = await new Promise<{ code: number; stderr: string; stdout: string }>(
        (resolve) => {
          const proc = spawn(scriptPath!, [inFile, outFile], { shell: isWin });
          let stdout = '';
          let stderr = '';
          proc.stdout?.on('data', (d) => (stdout += d.toString()));
          proc.stderr?.on('data', (d) => (stderr += d.toString()));
          proc.on('error', (err) => resolve({ stdout, stderr: stderr + err.message, code: 1 }));
          proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }));
        },
      );
      if (result.code === 0) {
        return await readFile(outFile, 'utf8');
      }
      // Si falla el script, sigue al fallback con class names
    }

    // Intentar 2: probar cada main class hasta que funcione
    let lastError = '';
    for (const mainClass of MPXJ_MAIN_CLASSES) {
      const result = await runJava(['-cp', classpath, mainClass, inFile, outFile]);
      if (result.code === 0) {
        return await readFile(outFile, 'utf8');
      }
      lastError = result.stderr || result.stdout;
      // Si el error es ClassNotFoundException, probamos siguiente. Si es otro, también seguimos.
      if (!lastError.includes('ClassNotFoundException') && !lastError.includes('Could not find or load main class')) {
        // Es otro tipo de error · no tiene sentido seguir intentando otras clases
        break;
      }
    }

    throw new Error(`MPXJ falló · probados ${MPXJ_MAIN_CLASSES.length} class names. Último error: ${lastError.slice(0, 500)}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
