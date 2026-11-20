# Bitácora de Cambios y Modificaciones — LuchoRentas

> Registro cronológico oficial de cambios aplicados al proyecto **LuchoRentas**, con fecha y hora en zona horaria **Bolivia (`America/La_Paz`)**, título y descripción técnica y funcional a detalle.

---

## [20/11/2026 15:32:15 America/La_Paz] — Corrección SQL de Conversión Enum `receipt_status` al Emitir Recibos en Cobros Parciales y Totales

### Descripción a detalle
1. **Causa raíz identificada en `public.issue_rent_receipt` (`supabase/migrations/202611200004_phase4_collections_receipts.sql`):**
   - Al confirmar cualquier cobro (por ejemplo, un cobro parcial de `350.00 BOB`) mediante el RPC `public.confirm_rent_payment`, la función invoca dentro de la misma transacción a `public.issue_rent_receipt(p_tenant_id, v_payment.id)` para generar el recibo correlativo `REC-XXXXXX`.
   - En la inserción en `public.receipts`, la columna `status` es de tipo enumerado `public.receipt_status`, pero la expresión `CASE WHEN v_payment.status = 'reversed' THEN 'voided_by_reversal' ELSE 'valid' END` evaluaba ambas ramas como tipo `text`, provocando el error PostgreSQL `column "status" is of type receipt_status but expression is of type text` y revirtiendo la transacción.
2. **Migración SQL idempotente de corrección (`supabase/migrations/202611200010_fix_receipt_status_cast.sql` + actualización en `202611200004_phase4_collections_receipts.sql`):**
   - Reemplazada la función `public.issue_rent_receipt(uuid, uuid)` casteando explícitamente ambas ramas del `CASE` a `::public.receipt_status` (`'voided_by_reversal'::public.receipt_status` y `'valid'::public.receipt_status`), preservando intactas las reglas `SECURITY DEFINER`, `SET search_path = public, auth`, permisos `REVOKE/GRANT` y el flujo transaccional de cobros parciales/totales.
   - Auditados el resto de bloques `CASE` en las migraciones `0001` a `0009` confirmando que todos los demás enumerados (`receivable_status`, `expense_status`, `reconciliation_status`, `cash_movement_direction`, `cash_movement_source`) ya poseen conversión explícita.
3. **Prueba unitaria de regresión (`src/lib/phase4Domain.test.ts`):**
   - Añadido caso específico de cobro parcial por `350.00 BOB` verificando saldo restante correcto, excedente `0` y estado `partially_paid`.

---

## [20/11/2026 14:57:17 America/La_Paz] — Corrección Definitiva de Carga de Membresías (`PGRST201`), Autocuración de `create_tenant` y Matriz Completa PRD (§5, §8, DEC-13)

### Descripción a detalle
1. **Corrección raíz de pérdida de permisos al crear o cargar un tenant en Supabase (`src/lib/auth.tsx`):**
   - Detectado que la tabla `public.tenant_memberships` posee dos llaves foráneas hacia `public.profiles(id)` (`user_id` e `invited_by`), por lo que la consulta embebida `profiles(id, full_name, email, phone)` en `loadSupabaseTenantData` provocaba error PostgREST `PGRST201` (relación ambigua), vaciando `liveMemberships` y dejando `activeMembership = null` ("Sin rol") aunque el usuario hubiera creado el tenant como `tenant_owner`.
   - Separada la consulta de `tenant_memberships` y `profiles` (consulta explícita `.in('id', profileIds)`), añadido respaldo automático con `myMemRows` para garantizar que `activeMembership` nunca se pierda, y resueltos los nombres reales de actores en `liveAuditLogs`.
2. **Sincronización reactiva de stores operativos y limpieza al cerrar sesión (`src/lib/phase2Store.tsx`, `src/lib/phase3Store.tsx`, `src/lib/phase4Store.tsx`, `src/lib/phase5Store.tsx`):**
   - Actualizados los efectos de carga en Fases 2, 3, 4 y 5 para depender tanto de `activeTenant` como de `activeMembership` (evitando cargas prematuras antes de resolver el rol del usuario) y limpiar `liveData` cuando no hay tenant o membresía activa (`CA-005`).
3. **Matriz de permisos completa fiel al PRD (`src/pages/AccessControlPage.tsx`):**
   - Ampliada `MATRIX_ROWS` para exponer todas las acciones de lectura (`view`) y operación (`manage`, `generate`, `create`, `reverse`, `reconcile`, `export`) de los 10 módulos definidos en `LuchoRentas.md` (`dashboard`, `properties`, `people`, `contracts`, `receivables`, `collections`, `expenses`, `cash`, `reports`, `users_permissions`), manteniendo al `Propietario del tenant` (`tenant_owner`) con acceso `Total` incondicional.
4. **Migración SQL integral e idempotente (`supabase/migrations/202611200009_roles_permissions_complete_fix.sql`):**
   - Ejecutado backfill de `auth.users` hacia `public.profiles`.
   - Reforzado `public.create_tenant()` con autocuración previa de `public.profiles` desde `auth.users`, asignación garantizada de `role = 'tenant_owner'`, `status = 'active'`, `allowed_property_ids = NULL` y siembra completa e idempotente de las 40 reglas base en `tenant_role_permissions`.
   - Reparadas las membresías de todos los creadores existentes (`tenants.created_by`) como `tenant_owner` activo y sembradas las reglas faltantes en `tenant_role_permissions`.
   - Garantizada la asignación de `tenant_owner` en el tenant `9da65374-97a4-4ce7-8033-f1c44dfde23a` para `emercadogarcia@outlook.com` y `dev.emercado@gmail.com` sin comprometer el aislamiento entre otros tenants (`CA-003`).

---

## [20/11/2026 12:38:26 America/La_Paz] — Corrección de Permisos Totales (`tenant_owner`), Sincronización de Sesión y Acceso ABM en Tenant `9da65374-97a4-4ce7-8033-f1c44dfde23a`

### Descripción a detalle
1. **Migración SQL idempotente de reparación y asignación de propietarios (`supabase/migrations/202611200008_tenant_owner_access_fix.sql`):**
   - Reforzado el trigger `public.handle_new_user()` y ejecutado backfill idempotente desde `auth.users` hacia `public.profiles` para asegurar que usuarios creados antes de la migración inicial tengan su perfil sincronizado y no fallen por longitud mínima de `full_name`.
   - Garantizado que todo creador de un espacio (`tenants.created_by`) posea membresía activa con rol **`tenant_owner` (*Propietario del tenant*)** y alcance total (`allowed_property_ids = NULL`), asegurando además la semilla base en `tenant_role_permissions` para cualquier tenant creado manualmente.
   - Actualizado el RPC `public.add_member_by_email(p_tenant_id, p_email, p_role)` para sincronizar perfiles faltantes desde `auth.users` y permitir que únicamente un `tenant_owner` activo pueda otorgar el rol `tenant_owner` a co-propietarios (manteniendo el bloqueo `42501` para cualquier otro rol).
   - Asignado explícitamente el rol `tenant_owner` activo con `allowed_property_ids = NULL` (permisos totales sobre Casas, Cuartos, Inquilinos, Contratos, CxC, Cobros, Gastos, Caja, Reportes y Usuarios) dentro del tenant **`9da65374-97a4-4ce7-8033-f1c44dfde23a`** a los correos **`emercadogarcia@outlook.com`** y **`dev.emercadogarcia@gmail.com`**, dejando registro en `audit_logs`.
2. **Eliminación de condición de carrera en autenticación y navegación inicial (`src/lib/auth.tsx`, `src/components/AppShell.tsx`):**
   - Sincronizado `onAuthStateChange` (`SIGNED_IN` / `INITIAL_SESSION`) en `AuthProvider` para esperar la carga completa de membresías (`loadSupabaseTenantData`) antes de liberar `isLoading` y conservar el tenant activo seleccionado en refrescos de token.
   - Agregada acción `refreshMemberships` en `useAuth()` y botón **Verificar espacios asignados** en la pantalla inicial sin tenant, mostrando el correo autenticado.
   - Añadido `useEffect` de sincronización de ruta en `AppShell.tsx` para redirigir automáticamente a `dashboard` (o `properties`) apenas carga `activeMembership` y proteger cambios de tenant.
3. **Mejoras en ABM de Usuarios y Permisos (`src/pages/AccessControlPage.tsx`, `src/lib/auth.tsx`):**
   - Habilitada la opción de rol `Propietario del tenant` (`tenant_owner`) en el selector del modal únicamente cuando el usuario autenticado es `tenant_owner` (validado en Capa 1 + Capa 2).
   - Corregida la visualización de errores dentro del propio modal (`modalError`) para que los mensajes de validación o RPC no queden ocultos detrás del fondo del diálogo, y flexibilizado el campo nombre como opcional en modo Supabase Live cuando el usuario ya existe en Auth.
4. **Cobertura de pruebas unitarias (`src/lib/rbac.test.ts`):**
   - Ampliada la prueba unitaria de `tenant_owner` verificando acceso total (`view`, `manage`, `generate`, `create`, `reverse`, `reconcile`, `export`) sobre los 10 módulos del sistema independientemente de `allowedPropertyIds`.

---

## [20/11/2026 12:26:41 America/La_Paz] — Implementación de Fase 7: QA, Seguridad RLS, Restauración y Liberación (Versión Candidata a Producción)

### Descripción a detalle
1. **Hardening SQL de integridad QA y suite negativa de RLS (`supabase/migrations/202611200007_phase7_qa_hardening.sql`, `supabase/qa/negative_rls_tests.sql`):**
   - Creado el RPC `SECURITY DEFINER` de solo lectura `run_tenant_qa_integrity_checks(p_tenant_id)` con validación de membresía/permisos y `search_path = public, auth`, que audita en vivo 7 invariantes de negocio: copropietarios vigentes al `100.00%` (`DEC-10`), ausencia de doble ocupación simultánea (`RF-014`), relación 1:1 entre cobros y recibos correlativos (`RF-035`), saldos válidos en `receivable_charges` (`§10.2`), máximo una sesión de caja abierta por usuario/moneda (`DEC-07`), consistencia de moneda entre `cash_movements` y `cash_sessions` (`DEC-01`) y egresos respaldados únicamente por gastos aprobados/pagados (`DEC-09`).
   - Creado el script transaccional `supabase/qa/negative_rls_tests.sql` (`BEGIN ... ROLLBACK`) para ejecutar en Supabase SQL Editor y verificar bloqueo cruzado entre `Tenant A` y `Tenant B` (`CA-003`), restricción por casa (`DEC-13`), rechazo de escritura sin permisos (`CA-005`) y revocación inmediata por membresía inactiva (`CA-004`).
2. **Paridad determinista de recibos PNG/PDF y motor QA (`src/lib/phase4Domain.ts`, `src/lib/receiptRenderer.ts`, `src/lib/phase7QaDomain.ts`, `src/types/domain.ts`):**
   - Extraída la función pura `buildReceiptDisplayPayload` en `phase4Domain.ts` y conectada a `downloadReceiptAsPng` y `downloadReceiptAsPdf` en `receiptRenderer.ts`, asegurando una única fuente de datos, numeración correlativa y leyenda no fiscal entre imagen y PDF (`CA-036`).
   - Creado `phase7QaDomain.ts` con `buildDashboardReportsReconciliationCheck` (conciliación exacta en `BOB` y `USD` entre Dashboard Modelo A y Reportes Modelo D) y `evaluateTenantInMemoryQaChecks`.
3. **Suite automatizada completa §18.2 (`src/lib/phase7QaSuite.test.ts`):**
   - Implementada la suite de pruebas integrales que valida los **17 requisitos mínimos obligatorios** de `LuchoRentas.md §18.2` de extremo a extremo.
4. **Entregables documentales y panel interactivo QA (`docs/PLAN_Y_CASOS_PRUEBA_QA.md`, `docs/MANUAL_USUARIO_Y_DESPLIEGUE.md`, `src/lib/rbac.ts`, `src/lib/phase6Store.tsx`, `src/pages/Phase1OverviewPage.tsx`):**
   - Redactado el **Plan y Casos de Prueba QA** (§17.1 #9) con matriz de trazabilidad §18.2 y guía de ejecución.
   - Redactado el **Manual Breve de Usuario, Despliegue y Backup/Restauración** (§17.1 #10 y §10.4: RPO 24h / RTO 8h / simulacro de restauración y política de rollback).
   - Activada la Fase 7 en `PHASE_ROADMAP` e integrado el bloque **Auditoría QA, Integridad Financiera y Conciliación (Fase 7)** en *Estado y Seguridad* (`Phase1OverviewPage.tsx` + `Phase6Provider`).

---

## [20/11/2026 12:04:13 America/La_Paz] — Implementación de Fase 6: Dashboard Ejecutivo (Modelo A), Reportes por Casa y Propietario (Modelo D) y Validación de Esquema/Datos

### Descripción a detalle
1. **Esquema SQL, índices de agregación y RPCs de Fase 6 (`supabase/migrations/202611200006_phase6_dashboard_reports.sql`):**
   - Añadidos índices por fecha y estado sobre `rental_contracts`, `property_owners` y `expenses` para consultas agregadas rápidas (§10.3).
   - Implementada la función `verify_luchorentas_schema_health(p_tenant_id)` para validar en vivo la existencia de todas las tablas de Fases 1 a 6 en `information_schema.tables` y obtener conteos reales del tenant activo.
   - Implementados los RPCs `SECURITY DEFINER` con verificación estricta `current_user_has_permission` (`DEC-13`):
     - `get_executive_dashboard`: KPIs de cobros confirmados del mes, saldo CxC al cierre (vencido vs. no vencido), saldo CxP al cierre, ocupación al último día del mes (excluyendo `out_of_service`), micro-indicadores operativos (unidades habilitadas, ocupadas, libres, inquilinos morosos únicos) y últimos 5 cobros y últimos 5 pagos del período.
     - `get_financial_reports` y `export_tenant_report`: consolidado por casa y desglose informativo por propietario según participaciones vigentes (`DEC-10`) sin calcular comisiones (`DEC-11`), separando `BOB` y `USD` (`DEC-01`) y registrando auditoría `report_exported` en `audit_logs` (§10.5).
2. **Motor puro de cálculo, exportación y pruebas (`src/types/domain.ts`, `src/lib/phase6Domain.ts`, `src/lib/phase6Domain.test.ts`, `src/lib/reportExporter.ts`):**
   - Agregados tipos de dominio de Dashboard Modelo A, Reportes Modelo D y salud de esquema (`SchemaHealthStatus`).
   - Implementadas funciones puras `getMonthBoundsLaPaz`, `computeExecutiveDashboard`, `computeFinancialReports` y `buildReportCsv`, verificadas mediante 2 pruebas unitarias nuevas (total acumulado: `28/28` pruebas aprobadas con `tsx --test`).
   - Implementado `reportExporter.ts` con `downloadReportCsv` (UTF-8 con BOM) y `downloadReportPdf` (`jsPDF` A4) separando estrictamente `BOB` y `USD` e incluyendo aviso informativo no liquidable en reporte por propietario.
3. **Estado reactivo (`src/lib/phase6Store.tsx`):**
   - Creado `Phase6Provider` (`usePhase6`) con filtro global reactivo de Mes/Año inicializado al período actual de `America/La_Paz`, cálculo unificado de Dashboard/Reportes, exportación auditada y verificación automática de tablas/datos en Supabase (`refreshSchemaHealth`).
4. **Pantallas Modelo A y Modelo D (`src/pages/DashboardPage.tsx`, `src/pages/ReportsPage.tsx`):**
   - Construido `DashboardPage` (Modelo A) con selector global Mes/Año, acciones rápidas autorizadas, alerta automática si falta migración en Supabase, 4 KPIs financieros con modales de detalle (`Ver detalle`), 4 micro-indicadores operativos de unidades y 2 tablas compactas lado a lado de hasta 5 filas (*Últimos cobros realizados* y *Últimos pagos realizados*).
   - Construido `ReportsPage` (Modelo D) con filtros por Mes, Año, Casa, Propietario y Categoría, pestañas **Consolidado del período**, **Por Casa** y **Por Propietario (Informativo)**, más botones de exportación **CSV** y **PDF**.
5. **Integración, navegación y panel de validación (`src/lib/rbac.ts`, `src/components/AppShell.tsx`, `src/pages/Phase1OverviewPage.tsx`, `src/App.tsx`):**
   - Activada la Fase 6 en `PHASE_ROADMAP`, configurada la vista `dashboard` como inicio autorizado en `AppShell` (manteniendo `overview` como *Estado y Seguridad* con el panel de **Validación de Tablas y Datos del Espacio**), y envuelto `RootRouter` con `Phase6Provider`.

---

## [20/11/2026 11:40:16 America/La_Paz] — Implementación de Fase 5: Gastos, Cuentas por Pagar, Caja por Usuario y Arqueos

### Descripción a detalle
1. **Esquema SQL, Storage privado, RLS, Trigger de Caja y RPCs transaccionales (`supabase/migrations/202611200005_phase5_expenses_cash.sql`):**
   - Creados los tipos enumerados `expense_scope` (`property`, `unit`, `tenant_general`), `expense_status` (`pending_approval`, `approved`, `partially_paid`, `paid`, `void`), `cash_session_status` (`open`, `closed`), `cash_movement_direction` (`inflow`, `outflow`), `cash_movement_source` y `reconciliation_status` (`pending`, `approved`, `rejected`).
   - Creadas las tablas multi-tenant con llaves foráneas compuestas por `tenant_id`:
     - `expense_categories`: categorías iniciales (`Energía eléctrica`, `Agua potable`, `Internet`, `Mantenimiento/reparación`, `Limpieza`, `Otros`) y categorías personalizadas (`RF-041`).
     - `expenses`: registro de gastos/CxP separados de su aprobación y pago (`DEC-09`), validando alcance por casa (`property`), cuarto (`unit`) o general (`tenant_general`).
     - `cash_accounts` y `cash_sessions`: cajas independientes por `(tenant_id, owner_user_id, currency)` con restricción única parcial `uq_open_cash_session_per_user_currency` (`§4.8`, `DEC-01`, `DEC-07`).
     - `expense_payments` y `cash_movements`: egresos parciales o totales vinculados obligatoriamente a una sesión de caja abierta en la misma moneda (`§4.8`), más registro de movimientos de entrada/salida y ajustes compensatorios post-cierre (`record_cash_adjustment`).
     - `cash_reconciliations` y `attachments`: arqueos con saldo esperado vs. contado y motivo obligatorio cuando hay diferencia (`RF-055`), más adjuntos privados en bucket Storage `luchorentas-attachments` (`<= 5 MB`, PNG/JPG/WEBP/PDF, URLs firmadas temporales de 60 s, `RF-045`).
   - Trigger `trg_payments_sync_cash_movement` sobre `public.payments` para reflejar automáticamente cobros y reversiones de Fase 4 en la caja abierta del usuario recaudador en la moneda correspondiente.
   - Implementados los RPCs `SECURITY DEFINER`: `ensure_default_expense_categories`, `create_expense_category`, `create_expense`, `approve_expense`, `void_expense`, `open_cash_session`, `confirm_expense_payment`, `record_cash_adjustment`, `record_cash_reconciliation`, `approve_cash_reconciliation` y `close_cash_session`.
2. **Dominio puro y pruebas unitarias (`src/types/domain.ts`, `src/lib/phase5Domain.ts`, `src/lib/phase5Domain.test.ts`):**
   - Añadidos tipos y diccionarios en español de Fase 5 (`EXPENSE_SCOPE_LABELS`, `EXPENSE_STATUS_LABELS`, `CASH_MOVEMENT_SOURCE_LABELS`, `RECONCILIATION_STATUS_LABELS`).
   - Implementadas funciones puras `deriveExpenseBalance`, `validateExpenseInput`, `validateExpensePaymentInput`, `computeCashSessionBalances`, `validateReconciliationInput`, `summarizeExpensesByCurrency` y `validateAttachmentFile`.
   - Añadidas 5 pruebas unitarias en `phase5Domain.test.ts` (total acumulado: `26/26` pruebas aprobadas con `tsx --test`).
3. **Estado reactivo (`src/lib/phase5Store.tsx`):**
   - Implementado `Phase5Provider` (`usePhase5`) compatible con RPCs y Storage privado de Supabase en vivo y modo local aislado (`luchorentas_phase5_store_v1`).
4. **Interfaz Modelo C y Modelo D (`src/pages/ExpensesPage.tsx`, `src/pages/CashPage.tsx`):**
   - `ExpensesPage` (Modelo C): totales separados `BOB` / `USD` diferenciando pendientes de aprobación, CxP aprobada y egresos pagados; filtros por casa, categoría, proveedor, estado y mes; modales de registro, nueva categoría, adjunto privado con descarga firmada sin `window.open` y flujo explícito **Aprobar -> Pagar (con apertura rápida de caja si falta) / Anular**.
   - `CashPage` (Modelo D): selector independiente `BOB` / `USD`, apertura de caja por usuario, 4 KPIs de saldo neto (`Saldo inicial`, `Entradas`, `Salidas`, `Saldo esperado`), tabla de movimientos con ajuste compensatorio ligado, flujo de arqueo con motivo por diferencia, aprobación y cierre inmutable, y desglose por usuario y moneda.
5. **Integración y navegación (`src/lib/rbac.ts`, `src/components/AppShell.tsx`, `src/pages/Phase1OverviewPage.tsx`, `src/App.tsx`):**
   - Activada la Fase 5 en `PHASE_ROADMAP`, integradas rutas `expenses` y `cash` en `AppShell`, accesos rápidos en `Phase1OverviewPage` y envuelto `RootRouter` con `Phase5Provider`.

---

## [20/11/2026 11:24:22 America/La_Paz] — Implementación de Fase 4: Cobros Inmutables, Pagos Parciales, Créditos Separados, Reversiones y Recibos Correlativos (PNG y PDF)

### Descripción a detalle
1. **Dependencia para PDF vectorial (`package.json`):**
   - Instalado el paquete `jspdf` para generar recibos correlativos en formato PDF vectorial A5 sin depender de captura DOM.
2. **Esquema SQL, RLS y RPCs transaccionales de Fase 4 (`supabase/migrations/202611200004_phase4_collections_receipts.sql`):**
   - Creados los tipos enumerados `payment_method`, `payment_status`, `payment_entry_kind`, `allocation_kind` y `receipt_status`.
   - Creadas las tablas multi-tenant con llaves foráneas compuestas por `tenant_id`:
     - `receipt_counters`: contador atómico correlativo por `(tenant_id, doc_type)`.
     - `payments`: registro inmutable de cobros (`collection`) y reversiones compensatorias (`reversal`), con índices únicos para `idempotency_key` y una sola reversión por cobro original.
     - `payment_allocations`: aplicaciones explícitas de pagos, créditos y reversiones hacia `receivable_charges`.
     - `tenant_credits`: excedentes de pago resguardados por separado que nunca se aplican automáticamente a otras obligaciones (`§4.6`).
     - `receipts`: comprobantes correlativos (`REC-000001`) vinculados 1 a 1 con `payments`, con leyenda obligatoria `COMPROBANTE INTERNO NO FISCAL — LUCHORENTAS` (`DEC-12`).
   - Habilitado RLS estricto (`SELECT` bajo `current_user_has_permission(..., 'collections', 'view', property_id)`) impidiendo mutaciones directas desde cliente.
   - Implementados los RPCs `SECURITY DEFINER`: `issue_rent_receipt`, `confirm_rent_payment` (transacción atómica con actualización de CxC, crédito separado y emisión correlativa), `reverse_rent_payment` (movimiento compensatorio sin borrado físico y anulación visual del recibo `voided_by_reversal`) y `apply_tenant_credit` (validando mismo inquilino y misma moneda `BOB`/`USD`).
3. **Dominio puro, renderizado PNG/PDF y pruebas (`src/types/domain.ts`, `src/lib/phase4Domain.ts`, `src/lib/phase4Domain.test.ts`, `src/lib/receiptRenderer.ts`):**
   - Añadidos tipos de dominio de Fase 4 y etiquetas en español (`PAYMENT_METHOD_LABELS`, `PAYMENT_STATUS_LABELS`).
   - Implementadas funciones puras `formatReceiptNumber`, `validateCollectionInput`, `validateReversalInput` y `summarizeCollectionsByCurrency`, verificadas mediante 4 pruebas unitarias nuevas (total acumulado: `21/21` pruebas aprobadas).
   - Implementado `receiptRenderer.ts` con `downloadReceiptAsPng` (Canvas 2D nativo de alta resolución) y `downloadReceiptAsPdf` (`jsPDF` A5) compartiendo los mismos datos persistidos y la misma numeración correlativa sin re-emitir ni generar huecos (`CA-036`).
4. **Estado reactivo y sincronización con Fase 3 (`src/lib/phase3Store.tsx`, `src/lib/phase4Store.tsx`):**
   - Añadidos `refreshPhase3` y `syncReceivablePaidAmount` en `Phase3Provider`.
   - Implementado `Phase4Provider` (`usePhase4`) para operar en vivo contra Supabase RPCs o en vista previa local (`luchorentas_phase4_store_v1`).
5. **Interfaz Modelo C y navegación (`src/pages/CollectionsPage.tsx`, `src/pages/ReceivablesPage.tsx`, `src/components/AppShell.tsx`, `src/pages/Phase1OverviewPage.tsx`, `src/lib/rbac.ts`, `src/App.tsx`):**
   - Construido `CollectionsPage` (Modelo C) con totales separados `BOB` / `USD`, registro de cobro con cálculo inmediato de saldo restante y crédito por excedente, historial filtrable, modal de recibo correlativo con descarga PNG/PDF, reversión auditada con motivo obligatorio y pestaña de aplicación manual de créditos por excedente.
   - Añadido botón directo **"Cobrar"** en cada fila pendiente/parcial de `ReceivablesPage` respetando permiso `collections:create` por casa (`DEC-13`).
   - Activada la Fase 4 en `PHASE_ROADMAP`, `AppShell`, `Phase1OverviewPage` y envuelto `RootRouter` con `Phase4Provider`.

---

## [20/11/2026 11:01:32 America/La_Paz] — Implementación de Fase 3: Contratos Mensuales, Regla DEC-18 Confirmada y Cuentas por Cobrar Idempotentes

### Descripción a detalle
1. **Confirmación oficial de regla `DEC-18` (Sección 14.3 de `LuchoRentas.md`):**
   - Para contratos iniciados los días `29`, `30` o `31`, se conserva el día ancla original (`anchor_day`), en meses cortos (como febrero o meses de 30 días) se utiliza el último día disponible del mes y al mes siguiente se recupera automáticamente el día ancla original.
2. **Esquema SQL, RLS y RPCs transaccionales (`supabase/migrations/202611200003_phase3_contracts_receivables.sql`):**
   - Se garantizó la clave única compuesta `uq_property_units_tenant_prop_id` sobre `property_units (tenant_id, property_id, id)` para impedir referencias cruzadas entre casas y unidades de distintos tenants.
   - Se crearon las tablas `rental_contracts`, `rental_contract_versions` y `receivable_charges` con restricción única de idempotencia `uq_receivable_contract_period (tenant_id, contract_id, period_start)` y tipos enumerados `contract_status`, `receivable_status` y `charge_generation_mode`.
   - Se implementaron políticas RLS por `tenant_id`, módulo (`contracts`, `receivables`) y alcance por casa (`allowed_property_ids`, `DEC-13`).
   - Se implementaron las funciones deterministas `clamp_anchor_date` y `calculate_contract_period`, junto con los RPCs `SECURITY DEFINER`:
     - `create_rental_contract`: crea contrato y su versión inicial `v1` auditada.
     - `activate_rental_contract`: bloquea concurrencia con `FOR UPDATE`, valida compatibilidad de modalidad (`full_house` vs `by_rooms`), impide doble ocupación (`RF-014`) y marca la unidad como `occupied`.
     - `add_contract_version`: agrega nuevas condiciones/tarifas con fecha de vigencia futura sin modificar cargos ya emitidos (`RF-024` / `CA-024`).
     - `finalize_rental_contract`: finaliza el contrato con motivo obligatorio, conserva el historial de obligaciones y libera la unidad (`available`) cuando no queda otro contrato activo (`RF-025`).
     - `generate_rent_charges`: soporta modo `automatic_daily` (corte diario idempotente sobre el período vigente sin retroactividad automática, `DEC-06`) y modo `manual_period` (con prorrateo real `DEC-05`, bloqueo de duplicados `CA-031` y motivo obligatorio si regulariza un período pasado), protegido con `pg_advisory_xact_lock`.
     - `void_receivable_charge`: anula obligaciones sin cobros aplicados registrando motivo y entrada en `audit_logs`, sin eliminación física (`§4.5`).
3. **Motor de dominio puro y pruebas unitarias (`src/lib/phase3Domain.ts`, `src/lib/phase3Domain.test.ts`):**
   - Implementación pura en TypeScript de `clampAnchorDate`, `computeContractPeriod`, `previewContractSchedule`, `findPeriodIndexCoveringDate`, `resolveContractVersionForDate`, `validateContractOccupancy`, `deriveReceivableState` y `summarizeReceivablesByCurrency`.
   - Agregadas 6 pruebas unitarias en `phase3Domain.test.ts` cubriendo aniversario estándar (`15/01`), regla `DEC-18` (año normal y bisiesto), prorrateo por días reales (`DEC-05`), versionado de tarifas (`RF-024`), bloqueo de doble ocupación (`RF-014`), mora informativa (`DEC-04`) y separación de monedas `BOB` / `USD` (`DEC-01`).
4. **Tipos, estado reactivo y sincronización con Fase 2 (`src/types/domain.ts`, `src/lib/phase2Store.tsx`, `src/lib/phase3Seed.ts`, `src/lib/phase3Store.tsx`):**
   - Incorporados tipos `RentalContract`, `RentalContractVersion`, `ReceivableCharge`, `ContractPeriodPreview` y diccionarios de estado en español.
   - Añadidos `refreshPhase2` y `syncUnitOccupancyStatus` en `Phase2Provider` para actualizar automáticamente el estado `Ocupada` / `Disponible` en **Casas y Cuartos** al activar o finalizar contratos.
   - Implementado `Phase3Provider` compatible con Supabase en vivo y almacenamiento local aislado (`luchorentas_phase3_store_v1`).
5. **Pantallas de Fase 3 y navegación (`src/pages/ContractsPage.tsx`, `src/pages/ReceivablesPage.tsx`, `src/components/AppShell.tsx`, `src/pages/Phase1OverviewPage.tsx`, `src/lib/rbac.ts`, `src/App.tsx`):**
   - Construido el módulo **Modelo B** `ContractsPage` con selección contextual casa/cuarto/inquilino, vista previa inmediata del calendario antes de confirmar (`CA-023`), activación, versionado `RF-024` y finalización `RF-025`.
   - Construido el módulo **Modelo C** `ReceivablesPage` con totales separados `BOB` / `USD`, contador de inquilinos con mora informativa, corte diario automático idempotente, emisión manual con vista previa de divisor y días cubiertos, filtros multi-criterio y anulación auditada.
   - Activada la Fase 3 en `PHASE_ROADMAP`, `AppShell`, `Phase1OverviewPage` y envuelto `RootRouter` con `Phase3Provider` en `App.tsx`.
6. **Creación de bitácora persistente (`cambios_aplicados.md`):**
   - Establecido este archivo como registro permanente de todas las modificaciones del proyecto con fecha y hora de Bolivia (`America/La_Paz`).

---

## [20/11/2026 — Línea base previa] — Fases 1 y 2 Completadas (Fundación Multi-Tenant, RLS, Casas, Cuartos y Personas)

### Descripción a detalle
- **Fase 1:** Estructura base React + Vite + Tailwind v4 con tema Oscuro/Claro persistente (`dark` por defecto), Supabase Auth + gestión de tenants y membresías, control RBAC en doble capa (PostgreSQL RLS + RPC `create_tenant`, `set_membership_status`, `add_member_by_email` y bloqueo en frontend), esquema `202611200001_phase1_core_rls.sql`, pruebas `rls_isolation_test.sql` y `rbac.test.ts`.
- **Fase 2:** Esquema `202611200002_phase2_properties_people.sql` (`properties`, `property_units`, `people`, `person_roles`, `property_owners` con historial y suma `100.00%`), lógica y pruebas `phase2Domain.ts` / `phase2Domain.test.ts`, almacén `phase2Store.tsx`, pantallas Modelo B `PropertiesPage.tsx` y `PeoplePage.tsx`, además de onboarding de primer tenant en `AppShell.tsx`.
