# Flujogramas ERP MM HighMetrik

Mapa lógico negocio antes de codear. Mermaid render en GitHub/VSCode.

## Documento maestro

| # | Doc | Descripción |
|---|---|---|
| **★** | **[AUDITORIA-TECNICA.md](./AUDITORIA-TECNICA.md)** | **Auditoría profunda · 10 puntos críticos · roadmap correcciones** |

## Flujos base · MVP

| # | Archivo | Cobertura |
|---|---|---|
| 01 | [ciclo-vida-proyecto](./01-ciclo-vida-proyecto.md) | State machine · transiciones |
| 02 | [estructura-economica](./02-estructura-economica.md) | CD+GG+Util+IGV · 3 montos |
| 03 | [flujo-dinero-global](./03-flujo-dinero-global.md) | Vista 360° entradas/salidas |
| 04 | [compra-almacen-consumo](./04-compra-almacen-consumo.md) | OC→kardex→consumo · ⚠️ ver P2 audit |
| 05 | [valorizacion-mensual](./05-valorizacion-mensual.md) | Cálculo cobranza mensual |
| 06 | [subcontratos](./06-subcontratos.md) | 2 modalidades · ⚠️ ver flujo 18 |
| 07 | [adelantos-amortizacion](./07-adelantos-amortizacion.md) | Adelantos + amortización |
| 08 | [modificaciones-contractuales](./08-modificaciones-contractuales.md) | Base · ⚠️ ver flujo 26 |
| 09 | [planilla-tareo](./09-planilla-tareo.md) | CAPECO · ⚠️ ver flujo 35 |
| 10 | [analisis-utility-real](./10-analisis-utility-real.md) | Cálculo utility · EVM |
| 11 | [cronograma-curva-s](./11-cronograma-curva-s.md) | 3 cronogramas · SPI/CPI |
| 12 | [workflow-aprobaciones](./12-workflow-aprobaciones.md) | Genérico |

## Flujos enterprise · Tier 1 crítico

| # | Archivo | Cobertura |
|---|---|---|
| 13 | [detraccion-retencion-sunat](./13-detraccion-retencion-sunat.md) | SUNAT completo · SPOT · PLE · SIRE |
| 14 | [reajuste-fp-iu](./14-reajuste-fp-iu.md) | IU · monomios · K · reconciliación |
| 15 | [garantias-completo](./15-garantias-completo.md) | Fianzas · pólizas · línea bancaria |
| 16 | [ingreso-provisional](./16-ingreso-provisional.md) | Stock con/sin docs · regularización |
| 17 | [adelanto-proveedor](./17-adelanto-proveedor.md) | Anticipo · canje · 6 fases |
| 18 | [back-to-back-sc](./18-back-to-back-sc.md) | SC limitado avance cliente |
| 19 | [cierre-mensual-contable](./19-cierre-mensual-contable.md) | 8 fases · validaciones |
| 26 | [cambios-contractuales-tipos](./26-cambios-contractuales-tipos.md) | Tipología completa Ley 32069 |
| 27 | [penalidades-completo](./27-penalidades-completo.md) | Sistema robusto · 3 orígenes |
| 28 | [dms-versionado](./28-dms-versionado.md) | ECM · planos · RFIs · firma · hash |
| 30 | [calidad-sst](./30-calidad-sst.md) | Protocolos · NCs · IPER · ATS · incidentes |
| 32 | [offline-first-edge](./32-offline-first-edge.md) | PWA · sync · IndexedDB |
| **38** | **[alertas-inteligentes](./38-alertas-inteligentes.md)** | **Motor nervioso ERP · 30+ alertas · ML scoring** |
| **41** | **[distribucion-gg-obras](./41-distribucion-gg-obras.md)** | **★ GG: auto + override gerencia con barandillas** |
| **42** | **[caja-chica-rendiciones](./42-caja-chica-rendiciones.md)** | **★ Fondo fijo · OCR ticket · validación SUNAT · kardex auto** |
| **43** | **[logistica-inversa-saldos-obra](./43-logistica-inversa-saldos-obra.md)** | **★ Saldos al cierre · disposiciones · bloqueo cierre · recupera S/** |
| **44** | **[liquidacion-final](./44-liquidacion-final.md)** | **★ Cierre formal contrato · plazos legales 60d · saldo final** |
| **45** | **[facturacion-electronica](./45-facturacion-electronica.md)** | **★ CPE · OSE · CDR · contingencia · resúmenes diarios** |
| **46** | **[arbitraje-controversias](./46-arbitraje-controversias.md)** | **★ Plazos caducidad · arbitraje · mecanismos · provisión** |
| **47** | **[recepcion-vicios-ocultos](./47-recepcion-vicios-ocultos.md)** | **★ Recepción + período 7 años post-cierre + reclamos** |
| **48** | **[cuaderno-obra-digital](./48-cuaderno-obra-digital.md)** | **★ Asientos diarios · firma residente+supervisor · hash chain** |
| **49** | **[mayores-gg-ampliacion](./49-mayores-gg-ampliacion.md)** | **★ Cobranza GG por días extra ampliación imputable entidad** |
| **50** | **[importador-s10](./50-importador-s10.md)** | **★ Excel S10 → partidas + APUs + insumos + FP automático** |
| **51** | **[gestion-riesgos-matriz](./51-gestion-riesgos-matriz.md)** | **★ Anexos 1,2,3 contrato · matriz P×I · 4 estrategias respuesta** |

## Flujos enterprise · Tier 2 alto

| # | Archivo | Cobertura |
|---|---|---|
| 20 | [cashflow-predictivo](./20-cashflow-predictivo.md) | Forecast 90d · escenarios |
| 23 | [consorcio-completo](./23-consorcio-completo.md) | Operador trib · cuentas orden |
| 24 | [procurement-avanzado](./24-procurement-avanzado.md) | RFQ · scoring · contratos marco |
| 25 | [flujos-extras](./25-flujos-extras.md) | Conciliación bancaria · OCR · móvil |
| 29 | [equipos-maquinaria](./29-equipos-maquinaria.md) | HM · combustible · mantto |
| 33 | [motor-reglas-parametrizacion](./33-motor-reglas-parametrizacion.md) | Parámetros configurables · cero downtime |
| **34** | **[tesoreria-avanzada](./34-tesoreria-avanzada.md)** | **Programación pagos · factoring · confirming · prest inter-obras** |
| **35** | **[rrhh-completo](./35-rrhh-completo.md)** | **Onboarding · contratos · legajos · biométrico · cese** |
| **37** | **[integracion-bancaria](./37-integracion-bancaria.md)** | **APIs bancos · pagos masivos · conciliación · CCI · BN** |
| **39** | **[multiempresa-holding](./39-multiempresa-holding.md)** | **Multi-RUC · consorcios · consolidación · intercompany** |
| **40** | **[productividad-rendimiento](./40-productividad-rendimiento.md)** | **HH/m³ · cuadrillas · variance APU · ML optimización** |

## Flujos arquitectura · Tier 3

| # | Archivo | Cobertura |
|---|---|---|
| 21 | [event-sourcing-cqrs](./21-event-sourcing-cqrs.md) | Event store · CQRS · audit inmutable |
| 22 | [bounded-contexts-ddd](./22-bounded-contexts-ddd.md) | DDD · 9 bounded contexts |
| 31 | [data-warehouse-bi](./31-data-warehouse-bi.md) | DW dimensional · ETL · ML |
| **36** | **[integracion-bim](./36-integracion-bim.md)** | **Modelo 3D · IFC · QTO · clash · 4D · 5D** |

## Cobertura por área negocio

| Área | Flujos relevantes |
|---|---|
| **Contractual** | 01, 02, 08, 23, 26 |
| **Operación obra** | 04, 05, 09, 11, 30, 40 |
| **Procurement** | 04, 16, 17, 24, 29 |
| **Financiero** | 03, 05, 07, 13, 14, 19, 20, 34, 41 |
| **Compliance** | 13, 14, 15, 27, 30 |
| **SC / Subcontratos** | 06, 18, 27 |
| **RRHH** | 09, 35 |
| **Tecnológico** | 21, 22, 28, 31, 32, 33, 36, 37 |
| **Tributario** | 13, 17, 19, 33, 37 |
| **Análisis · BI** | 10, 11, 20, 31, 38, 40 |
| **Multi-empresa** | 23, 39 |

## Roadmap implementación

```
Tier 1 crítico (6 meses):
  P1-P7 audit · 13 SUNAT · 14 reajuste · 15 garantías · 16 provisional ·
  17 adelantos · 18 back-to-back · 19 cierre · 26 cambios · 27 penalid ·
  28 DMS · 30 calidad/SST · 32 offline-first · 38 alertas · 41 GG

Tier 2 alto (12 meses):
  20 cashflow · 23 consorcio · 24 procurement · 25 extras ·
  29 equipos · 33 motor reglas · 34 tesorería · 35 RRHH ·
  37 bancaria · 39 multiempresa · 40 productividad

Tier 3 enterprise (18 meses):
  21 event sourcing · 22 DDD · 31 DW/BI · 36 BIM ·
  Multi-tenant RLS · firma digital legal

Tier 4 diferencial (24 meses):
  OCR · ML forecasting · SEACE API · IoT campo
```

## Convenciones color Mermaid

| Color | Significado |
|---|---|
| 🟢 Verde (`#d4edda`) | OK · aprobado · cobrado |
| 🔵 Azul claro (`#cce5ff`) | Doc/factura · contractual |
| 🟡 Amarillo (`#fff4cc`,`#ffc107`) | Pendiente · borrador · warning |
| 🟠 Naranja (`#fd7e14`) | SUNAT · alerta seria |
| 🔴 Rojo (`#dc3545`) | Crítico · bloqueo · rechazo |
| 🟣 Morado (`#7c4dff`) | Contable · DW · architecture |

## Lecturas recomendadas orden

### Para entender negocio:
1. `AUDITORIA-TECNICA.md`
2. `02-estructura-economica.md`
3. `03-flujo-dinero-global.md`
4. `10-analisis-utility-real.md`
5. `41-distribucion-gg-obras.md` ← **especial**
6. `26-cambios-contractuales-tipos.md`
7. `40-productividad-rendimiento.md`
8. `30-calidad-sst.md`

### Para arquitectura técnica:
1. `21-event-sourcing-cqrs.md`
2. `22-bounded-contexts-ddd.md`
3. `33-motor-reglas-parametrizacion.md`
4. `38-alertas-inteligentes.md`
5. `32-offline-first-edge.md`
6. `31-data-warehouse-bi.md`
7. `39-multiempresa-holding.md`

### Para SUNAT compliance:
1. `13-detraccion-retencion-sunat.md`
2. `14-reajuste-fp-iu.md`
3. `19-cierre-mensual-contable.md`
4. `33-motor-reglas-parametrizacion.md`

### Para integraciones:
1. `37-integracion-bancaria.md`
2. `36-integracion-bim.md`
3. `25-flujos-extras.md` (SEACE)
4. `28-dms-versionado.md`

## Métricas éxito ERP

```
Operativas:
  Tiempo cierre mensual           ≤ 10 días
  Variance kardex físico vs ERP   < 0.5%
  Movimientos provisionales 30d   = 0
  RUCs habido proveedores         100%
  Protocolos antes valorización   100%
  Productividad / APU             95-110%

Financieras:
  Detección utility temprana      < 30 días delay
  Cobertura reajuste FP            > 90%
  Costo financiero / utility       < 5%
  Días caja proyectada > 0         > 80% mes
  Penalidades tope                 < 5%

Compliance:
  Multas SUNAT                     S/ 0
  Garantías ejecutadas             0
  Penalidades aplicadas            tope < 5%
  Observaciones supervisor         < 3 por valoriz
  Accidentes graves                0

Técnicas:
  Uptime ERP                       99.9%
  Tiempo respuesta dashboard       < 2s
  Audit trail completo             100% acciones
  Backup recovery                  RTO < 4h, RPO < 1h
  Sync móvil offline ratio         > 60% operativos
  Alertas críticas reconocidas <1h  100%
```

## Resumen entregable

```
42 archivos en docs/flujos/
~110 diagramas Mermaid
~95 tablas SQL nuevas/modificadas
~150 KPIs definidos
9 bounded contexts DDD
30+ alertas catalogadas
33 categorías parámetros
```

## Estado cobertura · todos los puntos auditados

| Área audit | Cubierto |
|---|---|
| 1. Cambios contractuales tipología | ✓ flujo 26 |
| 2. Penalidades robusto | ✓ flujo 27 |
| 3. ECM/DMS versionado | ✓ flujo 28 |
| 4. Equipos/maquinaria | ✓ flujo 29 |
| 5. Planillas CAPECO | ✓ flujo 09 + 35 |
| 6. Calidad/SST | ✓ flujo 30 |
| 7. Workflow aprobaciones | ✓ flujo 12 |
| 8. Data warehouse BI | ✓ flujo 31 |
| 9. Offline-first | ✓ flujo 32 |
| 10. Motor reglas | ✓ flujo 33 |
| 11. Tesorería avanzada | ✓ flujo 34 |
| 12. RRHH completo | ✓ flujo 35 |
| 13. BIM integración | ✓ flujo 36 |
| 14. Bancaria real | ✓ flujo 37 |
| 15. Alertas inteligentes | ✓ flujo 38 |
| 16. Multiempresa holding | ✓ flujo 39 |
| 17. Productividad rendimiento | ✓ flujo 40 |
| 18. Distribución GG obras | ✓ flujo 41 |
| 19. Caja chica + rendiciones | ✓ flujo 42 |
| 20. Logística inversa · saldos obra | ✓ flujo 43 |
| 21. Liquidación final formal | ✓ flujo 44 |
| 22. Facturación electrónica OSE | ✓ flujo 45 |
| 23. Arbitraje + caducidad | ✓ flujo 46 |
| 24. Recepción + vicios 7 años | ✓ flujo 47 |
| 25. Cuaderno obra digital robusto | ✓ flujo 48 |
| 26. Mayores GG por ampliación | ✓ flujo 49 |
| 27. Importador S10 masivo | ✓ flujo 50 |
| 28. Gestión riesgos matriz | ✓ flujo 51 |
```
