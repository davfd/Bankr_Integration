import neo4j, { type Driver } from "neo4j-driver";

// Reads the Leonardo imagination graph (Neo4j :7687) — concept search.
// Mirrors leonardo-site's read pattern; injected into the gateway so tests mock it.

export type GraphHit = {
  id: string;
  name: string;
  mentions: number;
  domain: string | null;
  sourceKind: string | null;
};
export type GraphSearcher = (q: string, limit?: number) => Promise<GraphHit[]>;

const BLOCK = ["gutenberg", "copyright", "license", "licence", "trademark", "donation", "ebook", "public domain"];

let driver: Driver | null = null;
function getDriver(): Driver {
  if (!driver) {
    // The imagination graph is a LOCAL, read-only Neo4j with a well-known default
    // password (the same fallback `leonardo/config.py` and `.env.example` use).
    // Defaulting here — rather than throwing on a missing env var — means a
    // gateway restart that forgot to export LEONARDO_NEO4J_PASSWORD still serves
    // `search_graph` instead of silently 502-ing. Override via env for any
    // non-default deployment.
    const password = process.env.LEONARDO_NEO4J_PASSWORD ?? "leonardo_sf_ideas";
    driver = neo4j.driver(
      process.env.LEONARDO_NEO4J_URI ?? "bolt://localhost:7687",
      neo4j.auth.basic(process.env.LEONARDO_NEO4J_USER ?? "neo4j", password),
      { maxConnectionPoolSize: 8, connectionAcquisitionTimeout: 8000 },
    );
  }
  return driver;
}

export const realGraphSearch: GraphSearcher = async (q, limit = 12) => {
  const ql = q.trim().toLowerCase();
  if (ql.length < 2) return [];
  const session = getDriver().session({ defaultAccessMode: neo4j.session.READ });
  try {
    const res = await session.run(
      `MATCH (c:Concept)
       WITH c, toLower(coalesce(c.preferred_name, c.normalized_name, "")) AS lname
       WHERE lname CONTAINS $q AND NONE(t IN $block WHERE lname CONTAINS t)
       WITH c, lname LIMIT 250
       OPTIONAL MATCH (c)<-[:INSTANCE_OF]-(m:ConceptMention)
       OPTIONAL MATCH (c)-[:CATEGORIZED_AS]->(d:Domain)
       WITH c, lname, count(m) AS mentions, head(collect(d.path)) AS domain
       RETURN c.id AS id,
              coalesce(c.preferred_name, c.normalized_name, "(unnamed)") AS name,
              mentions, domain,
              head([(c)<-[:INSTANCE_OF]-(:ConceptMention)-[:IN_WORK]->(w:Work) | w.source_kind]) AS sourceKind,
              CASE WHEN lname STARTS WITH $q THEN 1 ELSE 0 END AS isPrefix
       ORDER BY isPrefix DESC, mentions DESC
       LIMIT $limit`,
      { q: ql, block: BLOCK, limit: neo4j.int(limit) },
    );
    return res.records.map((r) => {
      const m = r.get("mentions") as { toNumber?: () => number } | null;
      return {
        id: (r.get("id") as string) ?? "",
        name: (r.get("name") as string) ?? "",
        mentions: m?.toNumber?.() ?? 0,
        domain: (r.get("domain") as string) ?? null,
        sourceKind: (r.get("sourceKind") as string) ?? null,
      };
    });
  } finally {
    await session.close();
  }
};
