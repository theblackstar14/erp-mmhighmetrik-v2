/**
 * Expande catálogo IUs INEI · 80 índices unificados oficiales
 *
 * Fuente: INEI · Catálogo IU para reajuste de fórmula polinómica
 * Códigos 01-80 (estándar nacional Perú)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
const sql = postgres(process.env.DATABASE_URL!);

const IUS_INEI = [
  { codigo: '01', descripcion: 'ACERO DE CONSTRUCCION CORRUGADO', categoria: 'Materiales · Acero' },
  { codigo: '02', descripcion: 'ACERO DE CONSTRUCCION LISO', categoria: 'Materiales · Acero' },
  { codigo: '03', descripcion: 'ACERO ESTRUCTURAL', categoria: 'Materiales · Acero' },
  { codigo: '04', descripcion: 'AGREGADO FINO', categoria: 'Materiales · Agregados' },
  { codigo: '05', descripcion: 'AGREGADO GRUESO', categoria: 'Materiales · Agregados' },
  { codigo: '06', descripcion: 'ALBAÑILERIA', categoria: 'Materiales · Albañilería' },
  { codigo: '07', descripcion: 'ALAMBRE Y CABLE TIPO TW Y THW', categoria: 'Materiales · Eléctricos' },
  { codigo: '08', descripcion: 'ALAMBRE Y CABLE TIPO WP', categoria: 'Materiales · Eléctricos' },
  { codigo: '09', descripcion: 'ALCANTARILLA METALICA CORRUGADA', categoria: 'Materiales · Sanitarios' },
  { codigo: '10', descripcion: 'APARATO SANITARIO CON GRIFERIA', categoria: 'Materiales · Sanitarios' },
  { codigo: '11', descripcion: 'ARTEFACTO DE ALUMBRADO EXTERIOR', categoria: 'Materiales · Eléctricos' },
  { codigo: '12', descripcion: 'ARTEFACTO DE ALUMBRADO INTERIOR', categoria: 'Materiales · Eléctricos' },
  { codigo: '13', descripcion: 'ASFALTO', categoria: 'Materiales · Pavimentos' },
  { codigo: '14', descripcion: 'BALDOSA ACUSTICA', categoria: 'Materiales · Acabados' },
  { codigo: '15', descripcion: 'BLOQUE Y LADRILLO DE CONCRETO', categoria: 'Materiales · Albañilería' },
  { codigo: '16', descripcion: 'BLOQUE Y LADRILLO PARA TECHOS', categoria: 'Materiales · Albañilería' },
  { codigo: '17', descripcion: 'BLOQUE Y LADRILLO', categoria: 'Materiales · Albañilería' },
  { codigo: '18', descripcion: 'CABLE TELEFONICO', categoria: 'Materiales · Eléctricos' },
  { codigo: '19', descripcion: 'CABLES TIPO NKY-NYY', categoria: 'Materiales · Eléctricos' },
  { codigo: '20', descripcion: 'CEMENTO ASFALTICO', categoria: 'Materiales · Pavimentos' },
  { codigo: '21', descripcion: 'CEMENTO PORTLAND TIPO I', categoria: 'Materiales · Cemento' },
  { codigo: '22', descripcion: 'CEMENTO PORTLAND TIPO II', categoria: 'Materiales · Cemento' },
  { codigo: '23', descripcion: 'CEMENTO PORTLAND TIPO V', categoria: 'Materiales · Cemento' },
  { codigo: '24', descripcion: 'CERAMICA ESMALTADA Y SIN ESMALTAR', categoria: 'Materiales · Acabados' },
  { codigo: '25', descripcion: 'CERRAJERIA NACIONAL', categoria: 'Materiales · Herrajes' },
  { codigo: '26', descripcion: 'CONCRETO PREMEZCLADO', categoria: 'Materiales · Concreto' },
  { codigo: '27', descripcion: 'DETONANTE', categoria: 'Materiales · Voladura' },
  { codigo: '28', descripcion: 'DIFUSOR', categoria: 'Materiales · Eléctricos' },
  { codigo: '29', descripcion: 'DINAMITA', categoria: 'Materiales · Voladura' },
  { codigo: '30', descripcion: 'DOLAR MAS INFLACION DEL MERCADO USA', categoria: 'Importados' },
  { codigo: '31', descripcion: 'DOLAR', categoria: 'Importados' },
  { codigo: '32', descripcion: 'FLETE TERRESTRE', categoria: 'Logística' },
  { codigo: '33', descripcion: 'GASOLINA', categoria: 'Combustibles' },
  { codigo: '34', descripcion: 'GEOSINTETICOS', categoria: 'Materiales · Pavimentos' },
  { codigo: '35', descripcion: 'HERRAMIENTA MANUAL', categoria: 'Herramientas' },
  { codigo: '36', descripcion: 'HORMIGON', categoria: 'Materiales · Concreto' },
  { codigo: '37', descripcion: 'INDICE GENERAL DE PRECIOS AL CONSUMIDOR', categoria: 'General' },
  { codigo: '38', descripcion: 'INDICE GENERAL MANO DE OBRA CONSTRUCCION', categoria: 'General' },
  { codigo: '39', descripcion: 'INDICE GENERAL DE PRECIOS AL CONSUMIDOR', categoria: 'General' },
  { codigo: '40', descripcion: 'INDICE INDUSTRIAL', categoria: 'General' },
  { codigo: '41', descripcion: 'LOSETA VINILICA', categoria: 'Materiales · Acabados' },
  { codigo: '42', descripcion: 'MADERA IMPORTADA', categoria: 'Materiales · Madera' },
  { codigo: '43', descripcion: 'MADERA NACIONAL PARA ENCOFRADO Y CARPINTERIA', categoria: 'Materiales · Madera' },
  { codigo: '44', descripcion: 'MADERA TERCIADA PARA CARPINTERIA', categoria: 'Materiales · Madera' },
  { codigo: '45', descripcion: 'MAQUINARIA IMPORTADA', categoria: 'Equipos' },
  { codigo: '46', descripcion: 'MAQUINARIA NACIONAL', categoria: 'Equipos' },
  { codigo: '47', descripcion: 'MANO DE OBRA', categoria: 'Mano de obra · Construcción' },
  { codigo: '48', descripcion: 'MAQUINARIA Y EQUIPO NACIONAL', categoria: 'Equipos' },
  { codigo: '49', descripcion: 'MAQUINARIA Y EQUIPO IMPORTADO', categoria: 'Equipos' },
  { codigo: '50', descripcion: 'MARCO Y TAPA DE FIERRO FUNDIDO', categoria: 'Materiales · Sanitarios' },
  { codigo: '51', descripcion: 'PERFIL DE ACERO LIVIANO', categoria: 'Materiales · Acero' },
  { codigo: '52', descripcion: 'PERFIL DE ALUMINIO', categoria: 'Materiales · Carpintería' },
  { codigo: '53', descripcion: 'PERNOS', categoria: 'Materiales · Herrajes' },
  { codigo: '54', descripcion: 'PETROLEO INDUSTRIAL', categoria: 'Combustibles' },
  { codigo: '55', descripcion: 'PINTURA LATEX', categoria: 'Materiales · Acabados' },
  { codigo: '56', descripcion: 'PLANCHA DE ACERO LAC', categoria: 'Materiales · Acero' },
  { codigo: '57', descripcion: 'PLANCHA DE ACERO LAF', categoria: 'Materiales · Acero' },
  { codigo: '58', descripcion: 'PLANCHA DE FIBROCEMENTO', categoria: 'Materiales · Albañilería' },
  { codigo: '59', descripcion: 'PLANCHA DE POLIESTIRENO', categoria: 'Materiales · Aislantes' },
  { codigo: '60', descripcion: 'PLANCHA GALVANIZADA', categoria: 'Materiales · Acero' },
  { codigo: '61', descripcion: 'POSTES Y CRUCETAS DE MADERA', categoria: 'Materiales · Madera' },
  { codigo: '62', descripcion: 'POSTES Y CRUCETAS DE CONCRETO', categoria: 'Materiales · Concreto' },
  { codigo: '63', descripcion: 'TABLERO DE FIBRA', categoria: 'Materiales · Madera' },
  { codigo: '64', descripcion: 'TABLERO DE MADERA CONTRACHAPADO', categoria: 'Materiales · Madera' },
  { codigo: '65', descripcion: 'TABLERO ELECTRICO', categoria: 'Materiales · Eléctricos' },
  { codigo: '66', descripcion: 'TUBERIA ACERO NEGRO Y/O GALVANIZADO', categoria: 'Materiales · Tuberías' },
  { codigo: '67', descripcion: 'TUBERIA ASBESTO CEMENTO', categoria: 'Materiales · Tuberías' },
  { codigo: '68', descripcion: 'TUBERIA DE COBRE', categoria: 'Materiales · Tuberías' },
  { codigo: '69', descripcion: 'TUBERIA DE CONCRETO REFORZADO', categoria: 'Materiales · Tuberías' },
  { codigo: '70', descripcion: 'TUBERIA DE FIERRO FUNDIDO', categoria: 'Materiales · Tuberías' },
  { codigo: '71', descripcion: 'TUBERIA DE PLASTICO PVC', categoria: 'Materiales · Tuberías' },
  { codigo: '72', descripcion: 'TUBERIA DE PVC', categoria: 'Materiales · Sanitarios' },
  { codigo: '73', descripcion: 'TUBERIA PVC SAP', categoria: 'Materiales · Tuberías' },
  { codigo: '74', descripcion: 'TUBERIA PVC SEL', categoria: 'Materiales · Tuberías' },
  { codigo: '75', descripcion: 'TUERCA Y ARANDELA', categoria: 'Materiales · Herrajes' },
  { codigo: '76', descripcion: 'VIDRIO INCOLORO NACIONAL', categoria: 'Materiales · Carpintería' },
  { codigo: '77', descripcion: 'VIDRIO TEMPLADO', categoria: 'Materiales · Carpintería' },
  { codigo: '78', descripcion: 'VIDRIO DOBLE TEMPLADO NACIONAL', categoria: 'Materiales · Carpintería' },
  { codigo: '79', descripcion: 'VIDRIO INCOLORO NACIONAL', categoria: 'Materiales · Carpintería' },
  { codigo: '80', descripcion: 'YESO', categoria: 'Materiales · Acabados' },
];

let nuevos = 0;
let actualizados = 0;
for (const iu of IUS_INEI) {
  const r = await sql`
    INSERT INTO indices_unificados (codigo, descripcion, categoria, vigente)
    VALUES (${iu.codigo}, ${iu.descripcion}, ${iu.categoria}, true)
    ON CONFLICT (codigo) DO UPDATE SET
      descripcion = EXCLUDED.descripcion,
      categoria = EXCLUDED.categoria
    RETURNING (xmax = 0) AS inserted
  `;
  if (r[0]?.inserted) nuevos++;
  else actualizados++;
}

console.log(`✓ Catálogo IUs INEI sincronizado · ${nuevos} nuevos · ${actualizados} actualizados`);
console.log(`  Total: ${IUS_INEI.length} IUs disponibles (códigos 01-80)`);

await sql.end();
