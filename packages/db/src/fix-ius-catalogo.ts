/**
 * Hot-fix · sincroniza catálogo IUs con descripciones CAPECO oficiales
 * y agrega los 4 faltantes (10, 12, 24, 79)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
const sql = postgres(process.env.DATABASE_URL!);

const IUS = [
  { codigo: '02', descripcion: 'ACERO DE CONSTRUCCION LISO', categoria: 'Materiales · Acero' },
  { codigo: '03', descripcion: 'ACERO DE CONSTRUCCION CORRUGADO', categoria: 'Materiales · Acero' },
  { codigo: '05', descripcion: 'AGREGADO GRUESO', categoria: 'Materiales · Agregados' },
  { codigo: '07', descripcion: 'ALAMBRE Y CABLE TIPO TW Y THW', categoria: 'Materiales · Eléctricos' },
  { codigo: '10', descripcion: 'APARATO SANITARIO CON GRIFERIA', categoria: 'Materiales · Sanitarios' },
  { codigo: '12', descripcion: 'ARTEFACTO DE ALUMBRADO INTERIOR', categoria: 'Materiales · Eléctricos' },
  { codigo: '17', descripcion: 'BLOQUE Y LADRILLO', categoria: 'Materiales · Albañilería' },
  { codigo: '21', descripcion: 'CEMENTO PORTLAND TIPO I', categoria: 'Materiales · Cemento' },
  { codigo: '24', descripcion: 'CERAMICA ESMALTADA Y SIN ESMALTAR', categoria: 'Materiales · Acabados' },
  { codigo: '30', descripcion: 'DOLAR MAS INFLACION DEL MERCADO USA', categoria: 'Importados' },
  { codigo: '32', descripcion: 'FLETE TERRESTRE', categoria: 'Logística' },
  { codigo: '39', descripcion: 'INDICE GENERAL DE PRECIOS AL CONSUMIDOR', categoria: 'General' },
  { codigo: '43', descripcion: 'MADERA NACIONAL PARA ENCOFRADO Y CARPINTERIA', categoria: 'Materiales · Madera' },
  { codigo: '44', descripcion: 'MADERA TERCIADA PARA CARPINTERIA', categoria: 'Materiales · Madera' },
  { codigo: '47', descripcion: 'MANO DE OBRA', categoria: 'Mano de obra · Construcción' },
  { codigo: '48', descripcion: 'MAQUINARIA Y EQUIPO NACIONAL', categoria: 'Equipos' },
  { codigo: '72', descripcion: 'TUBERIA DE PVC', categoria: 'Materiales · Sanitarios' },
  { codigo: '79', descripcion: 'VIDRIO INCOLORO NACIONAL', categoria: 'Materiales · Carpintería' },
];

for (const iu of IUS) {
  await sql`
    INSERT INTO indices_unificados (codigo, descripcion, categoria)
    VALUES (${iu.codigo}, ${iu.descripcion}, ${iu.categoria})
    ON CONFLICT (codigo) DO UPDATE SET
      descripcion = EXCLUDED.descripcion,
      categoria = EXCLUDED.categoria
  `;
}

console.log(`✓ ${IUS.length} IUs sincronizados (insertados o actualizados)`);

await sql.end();
