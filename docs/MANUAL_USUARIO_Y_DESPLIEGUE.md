# Manual Breve de Usuario, Despliegue y Recuperación — LuchoRentas

> **Entregable §17.1 #10 y §10.4** · **Versión:** 1.1 (Candidata a producción) · **Zona horaria operativa:** `America/La_Paz` · **Monedas:** `BOB` y `USD` separadas.

---

## 1. Manual Breve de Usuario por Rol

### 1.1 Flujo Diario Recomendado
1. **Inmuebles y Personas (`Casas y Cuartos`, `Personas`):** Registrar las casas (modalidad *Casa completa* o *Por cuartos*), asignar copropietarios sumando `100%` y crear fichas únicas de inquilinos y proveedores.
2. **Contratos y Cuentas por Cobrar (`Contratos`, `Cuentas por Cobrar`):** Activar contratos mensuales por fecha de aniversario (`DEC-18`), verificar la vista previa de prorrateo real y generar o revisar las CxC del período.
3. **Apertura de Caja y Cobranza (`Caja y Arqueo`, `Cobros y Recibos`):** Abrir la sesión de caja del día en la moneda correspondiente (`BOB` o `USD`). Al registrar un cobro (total, parcial o con excedente a crédito), se emite automáticamente un recibo interno correlativo descargable en **Imagen PNG** y **PDF**.
4. **Gastos y Pagos a Proveedores (`Gastos y CxP`):** Registrar el gasto (casa, cuarto o general), aprobarlo explícitamente y recién confirmar el pago desde una caja abierta en la misma moneda.
5. **Arqueo, Dashboard y Reportes (`Caja y Arqueo`, `Dashboard`, `Reportes`):** Realizar el arqueo justificando cualquier diferencia, cerrar la caja y revisar el consolidado mensual por período, por casa y por propietario (informativo sin comisiones).

### 1.2 Alcance por Rol
| Rol | Qué puede hacer | Restricciones clave |
|---|---|---|
| **Propietario del tenant** | Control total del espacio, usuarios, permisos por casa, contratos, cobros, gastos, caja y reportes. | Aislado estrictamente a su `tenant_id`. |
| **Administrador** | Opera inmuebles, personas, contratos, CxC, cobros/reversiones, gastos, caja y reportes según matriz de permisos. | Puede limitarse a casas específicas (`allowed_property_ids`). |
| **Cobrador** | Consulta CxC, registra cobros, descarga recibos PNG/PDF y visualiza su propia caja. | No aprueba gastos ni revierte cobros (salvo permiso explícito). |
| **Operador financiero** | Registra/aprueba/paga gastos, administra caja, registra arqueos y exporta reportes. | No administra contratos ni cobros de alquiler. |
| **Consulta (Solo lectura)** | Visualiza Dashboard, inmuebles, CxC y reportes permitidos. | Sin permisos de creación, edición o exportación financiera. |

---

## 2. Guía de Despliegue Ordenado a Producción (§12)

### 2.1 Variables de Entorno del Frontend
Configurar en el proveedor de hosting (sin claves privilegiadas `service_role` en cliente):
```env
VITE_SUPABASE_URL=https://<tu-proyecto>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key-publica>
```

### 2.2 Secuencia Obligatoria de Migraciones SQL en Supabase
Ejecutar en **orden estricto** en el SQL Editor o mediante Supabase CLI (`supabase db push`):
1. `supabase/migrations/202611200001_phase1_core_rls.sql` — Núcleo multi-tenant, roles, permisos, auditoría y RLS base.
2. `supabase/migrations/202611200002_phase2_properties_people.sql` — Casas, unidades, personas multi-rol y copropietarios.
3. `supabase/migrations/202611200003_phase3_contracts_receivables.sql` — Contratos mensuales, versiones y CxC idempotentes.
4. `supabase/migrations/202611200004_phase4_collections_receipts.sql` — Cobros inmutables, créditos, reversiones y recibos correlativos.
5. `supabase/migrations/202611200005_phase5_expenses_cash.sql` — Gastos/CxP, cajas por usuario/moneda, arqueos y Storage privado.
6. `supabase/migrations/202611200006_phase6_dashboard_reports.sql` — Agregaciones de Dashboard, Reportes y `verify_luchorentas_schema_health`.
7. `supabase/migrations/202611200007_phase7_qa_hardening.sql` — Auditoría viva `run_tenant_qa_integrity_checks`.

### 2.3 Configuración del Job Diario de Cuentas por Cobrar (`DEC-06`)
Programar un cron diario en Supabase (`pg_cron` o Edge Function protegida ejecutando `generate_daily_rent_charges`) a las `00:15 America/La_Paz` (`04:15 UTC`). La clave única `(tenant_id, contract_id, period_start)` garantiza idempotencia si se reintenta manualmente.

### 2.4 Compilación y Publicación Web
```bash
npm ci
npx --yes tsx --test src/lib/*.test.ts
npm run lint
npm run build
```
Publicar la carpeta generada `dist/` con enrutamiento SPA hacia `index.html`.

---

## 3. Procedimiento de Backup, Restauración y Rollback (§10.4)

### 3.1 Objetivos Operativos
- **RPO objetivo:** Máximo **24 horas** (backups diarios automáticos en Supabase + respaldo lógico semanal fuera de la plataforma).
- **RTO objetivo:** Máximo **8 horas** para restauración integral en proyecto nuevo o PITR y re-apuntamiento DNS/env.

### 3.2 Respaldo Lógico Manual Previo a Cambios Mayores
Antes de aplicar cambios estructurales en producción:
```bash
pg_dump --format=custom --no-owner --no-privileges \
  --schema=public \
  --dbname="$SUPABASE_DB_URL" \
  -f "backup_luchorentas_$(TZ=America/La_Paz date +%Y%m%d_%H%M).dump"
```
Respaldar también los objetos del bucket privado `luchorentas-attachments` en almacenamiento seguro externo.

### 3.3 Procedimiento de Restauración Verificada (Simulacro Obligatorio)
1. Provisionar instancia/proyecto destino limpio (entorno `STAGING` o recuperación).
2. Restaurar esquema Auth y dump lógico (`pg_restore`) verificando que no existan errores en políticas RLS ni triggers (`trg_payments_sync_cash_movement`).
3. Restaurar objetos del bucket `luchorentas-attachments`.
4. Ejecutar `supabase/qa/negative_rls_tests.sql` para confirmar que RLS continúa activo tras restaurar.
5. Ingresar al frontend apuntando al entorno restaurado y ejecutar **Estado y Seguridad → Validar datos ahora** + **Ejecutar auditoría QA** para confirmar `7/7` invariantes SQL aprobadas.
6. Documentar fecha, responsable y resultado del simulacro (mínimo anual y tras cambios mayores).

### 3.4 Política de Rollback en Producción
- **Prohibido borrar movimientos financieros confirmados** (`payments`, `receipts`, `cash_movements`).
- Ante incidencias funcionales de frontend, revertir el despliegue estático a la versión previa etiquetada en Git.
- Ante incidencias de esquema SQL, aplicar una migración compensatoria compatible hacia adelante (`CREATE OR REPLACE FUNCTION` / reversión de vista o índice) validada previamente en `STAGING`.
