import fs from 'node:fs';
import { GoogleGenAI, Type, FunctionCallingConfigMode } from '@google/genai';
import type { RiskItem, PhaseMapping, RiskPhase } from '@devops-risk-analyzer/shared';
import { riskLevelToGrade } from '@devops-risk-analyzer/shared';

interface AIRiskFinding {
  title: string;
  detail: string;
  phases: Array<{
    phase: RiskPhase;
    impact: number;
    likelihood: number;
  }>;
}

const FUNCTION_DECLARATION = {
  name: 'report_documentation_risks',
  description: 'Report all DevOps risk findings identified in the documentation.',
  parameters: {
    type: Type.OBJECT,
    required: ['findings'],
    properties: {
      findings: {
        type: Type.ARRAY,
        description: 'List of risk findings found in the document.',
        items: {
          type: Type.OBJECT,
          required: ['title', 'detail', 'phases'],
          properties: {
            title:  { type: Type.STRING, description: 'Short risk title (max 80 chars)' },
            detail: { type: Type.STRING, description: 'Explanation of the risk and its consequences (max 300 chars)' },
            phases: {
              type: Type.ARRAY,
              description: 'DevOps phases this risk affects',
              items: {
                type: Type.OBJECT,
                required: ['phase', 'impact', 'likelihood'],
                properties: {
                  phase: {
                    type: Type.STRING,
                    enum: ['plan', 'code', 'build', 'test', 'release', 'deploy', 'operate', 'monitor'],
                  },
                  impact: {
                    type: Type.INTEGER,
                    description: '1=Negligible 2=Minor 3=Moderate 4=Major 5=Critical',
                  },
                  likelihood: {
                    type: Type.INTEGER,
                    description: '1=Rare 2=Unlikely 3=Possible 4=Likely 5=Almost certain',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You are a DevOps risk analyst. Given documentation from a software project, identify risks across the DevOps lifecycle phases: plan, code, build, test, release, deploy, operate, monitor.

Focus on:
- Missing or incomplete policies (security, change management, incident response, access control)
- Undocumented processes that could cause failures
- Lack of testing strategy or QA procedures
- Absent deployment or rollback procedures
- No monitoring or alerting documentation
- Security gaps (no security review process, missing threat model)
- Unclear ownership or responsibility
- Missing SLAs or runbooks

Rate each finding with:
- impact (1-5): how severe if this risk materialises
- likelihood (1-5): how probable given what the documentation reveals

Report only genuine findings. If the documentation is comprehensive and low-risk, report fewer (or zero) findings. Do not invent risks that are not evidenced by the document content.`;

export async function analyzeDocumentationWithAI(
  content: string,
  sourceLabel: string,
): Promise<RiskItem[]> {
  const mockPath = process.env['MOCK_DOC_ANALYSIS_PATH'];
  if (mockPath) {
    console.log(`[doc-ai] MOCK_DOC_ANALYSIS_PATH set — returning mock response from ${mockPath}`);
    return JSON.parse(fs.readFileSync(mockPath, 'utf8')) as RiskItem[];
  }

  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) {
    console.warn('[doc-ai] GEMINI_API_KEY not set — skipping documentation analysis');
    return [];
  }

  const ai = new GoogleGenAI({ apiKey });

  console.log(`[doc-ai] analyzing documentation from ${sourceLabel} (${content.length} chars)`);

  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: `${SYSTEM_PROMPT}\n\nAnalyze the following documentation for DevOps risks:\n\nSource: ${sourceLabel}\n\n---\n\n${content}`,
    config: {
      tools: [{ functionDeclarations: [FUNCTION_DECLARATION] }],
      toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } },
    },
  });

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const callPart = parts.find((p: { functionCall?: { name?: string } }) => p.functionCall?.name === 'report_documentation_risks');

  if (!callPart?.functionCall) {
    console.warn('[doc-ai] model did not call the reporting tool — returning empty findings');
    return [];
  }

  const { findings } = callPart.functionCall.args as { findings: AIRiskFinding[] };
  console.log(`[doc-ai] received ${findings.length} finding(s) from model`);

  return findings.map((f, i): RiskItem => {
    const phases: PhaseMapping[] = f.phases.map(p => {
      const riskLevel = p.impact * p.likelihood;
      return {
        phase: p.phase,
        impact: p.impact,
        likelihood: p.likelihood,
        riskLevel,
        riskGrade: riskLevelToGrade(riskLevel),
      };
    });

    return {
      id: `ai-documentation-${i}`,
      source: 'ai-documentation',
      artifact: 'documentation',
      phases,
      title: f.title,
      detail: f.detail,
    };
  });
}
