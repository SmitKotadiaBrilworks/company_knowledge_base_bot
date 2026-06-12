import { NextRequest, NextResponse } from "next/server";
import { ragQuery } from "@/lib/rag";
import type { QueryRequest } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  try {
    const body: QueryRequest = await req.json();
    const {
      query,
      document_id,
      search_type = "hybrid",
      match_count = 5,
    } = body;

    if (!query?.trim()) {
      return NextResponse.json(
        { error: "Query is required" },
        { status: 400 }
      );
    }

    const result = await ragQuery(query.trim(), {
      documentId: document_id,
      searchType: search_type,
      matchCount: match_count,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[query]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Query failed" },
      { status: 500 }
    );
  }
}
