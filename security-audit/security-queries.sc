// security-audit/security-queries.sc
//
// Layer 3 of the four-layer security audit: Joern semantic / dataflow queries.
// The script runs against a pre-parsed Code Property Graph (cpg.bin) and emits a
// JSON array of findings consumed by the findings-layer-3-joern.json transform.
//
// Usage (Joern 4.x):
//   joern --script security-audit/security-queries.sc \
//         --param cpgFile=security-audit/cpg.bin \
//         --param out=security-audit/results-joern.json
//
// Each emitted finding object has the fields:
//   file        - source file path of the finding (sink) location
//   line        - line number of the finding (sink) location
//   severity    - native Joern severity: one of high | medium | low | info
//   description - short functional description of the finding
//   family      - one of: command-exec | orm-raw-sql |
//                 taint-reachability | authz-bypass
//
// Route/request parameters are collected as taint sources and feed the
// taint-reachability family; they are not emitted as standalone findings.
//
// Read-only: the script only queries the CPG. Its sole write is the JSON file
// passed via the --param out=... argument.

import io.shiftleft.semanticcpg.language._
import io.joern.dataflowengineoss.language._
import io.joern.dataflowengineoss.queryengine.EngineContext

@main def main(cpgFile: String, out: String = "security-audit/results-joern.json"): Unit = {
  // Load the Code Property Graph produced by joern-parse.
  importCpg(cpgFile)

  // Implicit dataflow engine context required by sink.reachableByFlows(source).
  implicit val engineContext: EngineContext = EngineContext()

  // Accumulator of candidate findings as (file, line, severity, description, family).
  val collected = scala.collection.mutable.ArrayBuffer.empty[(String, Int, String, String, String)]

  // Severity ranking used for within-family deduplication (higher wins).
  def severityRank(severity: String): Int = severity match {
    case "high"   => 3
    case "medium" => 2
    case "low"    => 1
    case _        => 0
  }

  // Collapse internal whitespace and cap description length at 200 characters.
  def clip(text: String, max: Int = 200): String = {
    val flat = if (text == null) "" else text.replaceAll("\\s+", " ").trim
    if (flat.length > max) flat.substring(0, max) else flat
  }

  // Filenames used for nodes that carry no real source location.
  val unknownLocationMarkers = Set("N/A", "<empty>", "<unknown>", "")

  // Record one candidate finding when it has an actionable file:line location.
  def record(file: String, line: Int, severity: String, description: String, family: String): Unit = {
    val safeFile = if (file == null) "" else file
    if (!unknownLocationMarkers.contains(safeFile) && line > 0)
      collected += ((safeFile, line, severity, clip(description), family))
  }

  // Files that reference the Node child_process module via import, require, or a
  // module-name literal. Detected three independent ways and unioned.
  val childProcessFiles: Set[String] = {
    val viaLiteral = cpg.literal.code(".*child_process.*").file.name.toSet
    val viaImports = scala.util.Try(
      cpg.imports.filter(_.importedEntity.exists(_.contains("child_process"))).file.name.toSet
    ).getOrElse(Set.empty[String])
    val viaRequire = scala.util.Try(
      cpg.call.name("require").where(_.argument.isLiteral.code(".*child_process.*")).file.name.toSet
    ).getOrElse(Set.empty[String])
    viaLiteral ++ viaImports ++ viaRequire
  }

  // Exact Node child_process command/process execution API names.
  val childProcessApi = Set("exec", "execSync", "execFile", "execFileSync", "spawn", "spawnSync", "fork")

  // Prisma raw SQL sink calls: $queryRaw, $executeRaw, queryRawUnsafe, executeRawUnsafe.
  val rawSqlCalls = cpg.call.name(".*queryRaw.*|.*executeRaw.*").l

  // ---- Family: command-exec (OS command / code execution sink calls) ----
  // Directive primitive (verbatim): candidate command/code-execution sink call names.
  val commandCandidates = (cpg.call.name("exec.*|eval|spawn").l ++ cpg.call.name("spawn.*|fork|execFile.*").l).distinct
  // new Function(...) dynamic code construction.
  val functionCtorCalls = cpg.call.name("Function").filter(_.code.contains("new Function")).l
  // Retain only candidates that resolve to a real execution API: a child_process
  // function called in a child_process-referencing file, or the global eval(...).
  val commandSinkCalls = commandCandidates.filter { call =>
    val name = call.name
    (childProcessApi.contains(name) && childProcessFiles.contains(call.location.filename)) ||
    (name == "eval" && call.code.trim.startsWith("eval("))
  } ++ functionCtorCalls
  try {
    commandSinkCalls.distinct.foreach { call =>
      // A non-literal argument indicates a dynamically constructed command.
      val nonLiteralArgs = call.argument.l.count(arg => arg.label != "LITERAL")
      val severity = if (nonLiteralArgs > 0) "high" else "medium"
      val description = s"Command/code execution sink '${call.name}' invoked: ${call.code}"
      record(call.location.filename, call.location.lineNumber.getOrElse(-1), severity, description, "command-exec")
    }
  } catch { case e: Throwable => System.err.println("[command-exec] skipped: " + e.getMessage) }

  // ---- Family: orm-raw-sql (Prisma raw query sink calls) ----
  try {
    rawSqlCalls.distinct.foreach { call =>
      // Detect the *Unsafe API variants by name.
      val isUnsafeApi = call.name.toLowerCase.contains("unsafe")
      // Nested operators in the argument subtree indicate dynamically built SQL.
      val argOperators = call.argument.ast.isCall.name.l
      val usesConcatenation = argOperators.contains("<operator>.addition")
      val usesInterpolation = argOperators.contains("<operator>.formatString") || call.code.contains("${")
      val severity =
        if (isUnsafeApi || usesConcatenation) "high"
        else if (usesInterpolation) "medium"
        else "low"
      val description = s"Prisma raw SQL sink '${call.name}': ${call.code}"
      record(call.location.filename, call.location.lineNumber.getOrElse(-1), severity, description, "orm-raw-sql")
    }
  } catch { case e: Throwable => System.err.println("[orm-raw-sql] skipped: " + e.getMessage) }

  // ---- Route-parameter sources (directive route query; taint-source inventory) ----
  try {
    // Directive route query: parameters of methods carrying a Route-style annotation.
    val directiveRouteParams = {
      import scala.language.implicitConversions
      implicit def annotationTraversalToBoolean(it: Iterator[_]): Boolean = it.nonEmpty
      cpg.method.filter(_.annotation.name(".*Route.*")).parameter.l
    }
    // NestJS / Next.js HTTP route-handler parameters via method decorators.
    val httpRouteParams = cpg.method.where(_.annotation.name("Get|Post|Put|Patch|Delete|All|.*Route.*")).parameter.l
    // Parameters decorated as request-input carriers.
    val requestParams = cpg.parameter.where(_.annotation.name("Body|Query|Param|Headers|Req|Request|UploadedFile|Ip|Session")).l
    // Distinct source set excluding the implicit receiver (this).
    val routeParamSources = (directiveRouteParams ++ httpRouteParams ++ requestParams).distinct.filterNot(_.name == "this")
    System.err.println(s"[route-params] route/request parameter taint sources (metadata only): ${routeParamSources.size}")
  } catch { case e: Throwable => System.err.println("[route-params] skipped: " + e.getMessage) }

  // ---- Family: authz-bypass (fail-open guards and unguarded routes) ----
  try {
    // NestJS guards implement canActivate; record the fail-open pattern where a
    // literal true is returned from a catch/error branch.
    cpg.method.name("canActivate").l.foreach { guard =>
      val failOpen = guard.ast.isControlStructure.controlStructureType("CATCH").ast.isLiteral.code("true").nonEmpty
      if (failOpen) {
        val owner = guard.typeDecl.name.headOption.getOrElse(guard.name)
        val description = s"Authorization guard '$owner' may fail open: returns true in a catch/error path"
        record(guard.location.filename, guard.location.lineNumber.getOrElse(-1), "high", description, "authz-bypass")
      }
    }
    // HTTP route handlers with no method-level or class-level @UseGuards.
    cpg.method.where(_.annotation.name("Get|Post|Put|Patch|Delete|All")).l.foreach { handler =>
      val methodGuarded = handler.annotation.name("UseGuards").nonEmpty
      val classGuarded = handler.typeDecl.annotation.name("UseGuards").nonEmpty
      if (!methodGuarded && !classGuarded) {
        val description = s"Route handler '${handler.name}' has no @UseGuards (method or controller level)"
        record(handler.location.filename, handler.location.lineNumber.getOrElse(-1), "medium", description, "authz-bypass")
      }
    }
  } catch { case e: Throwable => System.err.println("[authz-bypass] skipped: " + e.getMessage) }

  // ---- Family: taint-reachability (request input reaching dangerous sinks) ----
  try {
    // Untrusted sources: request-decorated parameters and route-handler parameters,
    // excluding the implicit receiver (this) parameter on instance methods.
    val sourceNodes =
      (cpg.parameter.where(_.annotation.name("Body|Query|Param|Headers|Req|Request|UploadedFile|Ip|Session")).l ++
        cpg.method.where(_.annotation.name("Get|Post|Put|Patch|Delete|All|.*Route.*")).parameter.l)
        .distinct.filterNot(_.name == "this")
    val source = sourceNodes.iterator
    // High-value sinks: the resolved command/code-execution sinks and Prisma raw SQL calls.
    val sink = (commandSinkCalls ++ rawSqlCalls).distinct.iterator.argument
    // Directive primitive (verbatim): inter-procedural taint reachability.
    val flows = sink.reachableByFlows(source).l
    flows.foreach { path =>
      val elements = path.elements
      if (elements.nonEmpty) {
        val sinkNode = elements.last
        val sourceNode = elements.head
        val description = s"Tainted data flow (${elements.size} steps) from '${sourceNode.code}' to sink '${sinkNode.code}'"
        record(sinkNode.location.filename, sinkNode.location.lineNumber.getOrElse(-1), "high", description, "taint-reachability")
      }
    }
  } catch { case e: Throwable => System.err.println("[taint-reachability] skipped: " + e.getMessage) }

  // Within-family deduplication: keep the highest-severity finding per (file, line, family).
  val deduped = collected
    .groupBy { case (file, line, _, _, family) => (file, line, family) }
    .map { case (_, group) => group.maxBy { case (_, _, severity, _, _) => severityRank(severity) } }
    .toList
    .sortBy { case (file, line, _, _, family) => (family, file, line) }

  // Assemble the JSON findings array.
  val findingsArray = ujson.Arr()
  deduped.foreach { case (file, line, severity, description, family) =>
    findingsArray.value += ujson.Obj(
      "file"        -> file,
      "line"        -> line,
      "severity"    -> severity,
      "description" -> description,
      "family"      -> family
    )
  }

  // Resolve the output path against the working directory and ensure its parent exists.
  val targetPath = os.Path(out, os.pwd)
  try { os.makeDir.all(targetPath / os.up) } catch { case _: Throwable => () }
  os.write.over(targetPath, ujson.write(findingsArray))

  println(s"[security-queries] wrote ${deduped.size} findings to ${targetPath}")
}
