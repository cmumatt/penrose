import { A, ASTNode } from "types/ast";
import { DomainProg } from "types/domain";
import {
  ISourceMapEntity,
  ISourceRef,
  ShapeSourceMap,
  SourceEntityType,
  SourceProgramType,
} from "types/state";
import { RelationPatternSubst, Selector, StyProg } from "types/style";
import { SubProg } from "types/substance";
import { pruneSubNodes } from "./Style";

/**
 * !!! Document
 * !!! Add checks for state transitions
 */
export class Debugger<T> {
  private state = 0; // 0=listening, 1=answering
  private static theInstance: Debugger<A>;
  private rep: DebugStyleBlock<T>[] = [];
  private srcMap?: ShapeSourceMap;
  private domSrc = "";
  private subSrc = "";
  private stySrc = "";
  private domAst?: DomainProg<T>;
  private subAst?: SubProg<T>;
  private styAst?: StyProg<T>;

  // ------------------------- Singleton Impl. -----------------------------//

  public static newInstance(): Debugger<A> {
    this.theInstance = new Debugger();
    return this.theInstance;
  }
  public static getInstance(): Debugger<A> {
    if (this.theInstance == undefined) {
      return Debugger.newInstance();
    } else {
      return this.theInstance;
    }
  }

  // ------------------------ Setters / Getters ----------------------------//

  public addBlock(block: DebugStyleBlock<T>): void {
    this.moveToListeningState();
    this.rep.push(JSON.parse(JSON.stringify(block)));
  }
  public getBlocks(): DebugStyleBlock<T>[] {
    return JSON.parse(JSON.stringify(this.rep));
  }
  public setDomSrc(domSrc: string): void {
    this.moveToListeningState();
    this.domSrc = domSrc;
  }
  public setSubSrc(subSrc: string): void {
    this.moveToListeningState();
    this.subSrc = subSrc;
  }
  public setStySrc(stySrc: string): void {
    this.moveToListeningState();
    this.stySrc = stySrc;
  }
  public setDomAst(domAst: DomainProg<T>): void {
    this.moveToListeningState();
    this.domAst = domAst;
  }
  public setSubAst(subAst: SubProg<T>): void {
    this.moveToListeningState();
    this.subAst = subAst;
  }
  public setStyAst(styAst: StyProg<T>): void {
    this.moveToListeningState();
    this.styAst = styAst;
  }
  public toString():string {
    return JSON.stringify(pruneSubNodes(this, ["children", "where"]));
  }

  // ----------------------------- Queries ---------------------------------//

  /**
   * This query returns true if the style block at styLine with style variable
   * styVar bound to substance object subObj satisfied the style block's requirements.
   * 
   * Note: Exceptions are thrown if no style block is present at styLine or the style
   * block does not have style variable styVar.
   * 
   * @param styLine 
   * @param styVar 
   * @param subObj 
   * @returns 
   */
  public queryDidStyleBlockApply( styLine: number, styVar: string, subObj: string ): boolean {
    // Ensure we are in a suitable state to answer questions
    this.moveToAnsweringState();

    let blockFound = false; // We found the style block at styLine
    let unsatFound = false; // We found subObj does not satisfy parts of the style block
    let satFound = false; // We found subObj satisfies parts of the style block

    // Loop over each style block to find the one specified on input
    this.rep.forEach((block) => {
      // Find the block specified by the line number; ignore the rest
      if(block.sel["start"].line <= styLine && block.sel["end"].line >= styLine) {
        blockFound = true;
        unsatFound = unsatFound && block.unsats.some((rel) => this.hasMatchingSubstitution(rel,block,styVar,subObj));
        satFound = satFound && block.sats.some((rel) => this.hasMatchingSubstitution(rel,block,styVar,subObj));
      }
    });

    // If we did not find the style block specified, throw an exception
    if(!blockFound) {
      throw new Error(`Style block at line ${styLine} not found`);
    }

    // We already tested to verify the variables match.  If there are no
    // unsats present, then the block is satisfied and was applied.
    return satFound && !unsatFound;
  }

  // !!! Doc
  public queryExplainStyleBlockApplication( styLine: number, styVar: string, subObj: string ): DebugStyleBlockRel<T>[] {
    // Ensure we are in a suitable state to answer questions
    this.moveToAnsweringState();
    let theBlock: DebugStyleBlock<T> | undefined;

    // Loop over each style block to find the one specified on input
    this.rep.forEach((block) => {
      // Find the block specified by the line number; ignore the rest
      if(block.sel["start"].line <= styLine && block.sel["end"].line >= styLine) {
        theBlock = block;
      }
    });
    
    // If we did not find the style block specified, throw an exception
    if(theBlock === undefined) {
      throw new Error(`Style block at line ${styLine} not found`);
    } else {
      // Return the matching sats/unsat conditions.  Protect the rep.
      if(this.queryDidStyleBlockApply(styLine,styVar,subObj)) {
        return JSON.parse(JSON.stringify(theBlock.sats.filter((rel) => this.hasMatchingSubstitution(rel,theBlock as DebugStyleBlock<unknown>,styVar,subObj))));
      } else {
        return JSON.parse(JSON.stringify(theBlock.unsats.filter((rel) => this.hasMatchingSubstitution(rel,theBlock as DebugStyleBlock<unknown>,styVar,subObj))));
      }
    }
  }

  // -------------------------- State Control ------------------------------//

  private moveToListeningState(): void {
    this.state = 0;
  }
  private moveToAnsweringState(): void {
    if (this.state >= 1) {
      return; // No state change required
    } else  {
      if (this.domAst === undefined)
        throw new Error(
          "Unable to accept debug queries: no Domain AST loaded"
        );
      if (this.subAst === undefined)
        throw new Error(
          "Unable to accept debug queries: no Substance AST loaded"
        );
      if (this.styAst === undefined)
        throw new Error(
          "Unable to accept debug queries: no Style AST loaded"
        );
      if (this.domSrc == "")
        throw new Error(
          "Unable to accept debug queries: no Domain Source File loaded"
        );
      if (this.subSrc == "")
        throw new Error(
          "Unable to accept debug queries: no Substance Source File loaded"
        );
      if (this.stySrc == "")
        throw new Error(
          "Unable to accept debug queries: no Style Source File loaded"
        );

      // Transition to listening state:
      //  - Set the state to answering state
      //  - Generate the source map
      //  - Add source text to reasons
      // (!!! May consider lazy-evaluating this)
      this.state = 1; // Answering
      this.srcMap = mapShapesToSource(
        this.domAst,
        this.domSrc,
        this.subAst,
        this.subSrc,
        this.styAst,
        this.stySrc
      );
      this.addSourceToReasons();
    }
  }

  // ------------------------- Helper Functions ----------------------------//

  private addSourceToReasons() {
    this.moveToAnsweringState();
    console.log("Resolving source lines for unsats..."); //!!!
    this.rep.forEach((block) => {
      // Resolve source refs to source text
      block.unsats.concat(block.sats).forEach((unsat) => {
        unsat.reasons.forEach((reason) => {
          reason.srcRef.forEach((srcRef) => {
            srcRef.srcText = (this.srcMap as ShapeSourceMap).getSource(
              srcRef.origin,
              { line: srcRef.lineStart, col: srcRef.colStart },
              { line: srcRef.lineEnd, col: srcRef.colEnd }
            );
          });
        });
      });
    });
    console.log("Done Resolving source lines for unsats..."); //!!!
  }

  // Helper function to check if the block substitution applies to the query
  private hasMatchingSubstitution = ( rel: DebugStyleBlockRel<unknown>, block:DebugStyleBlock<unknown>, styVar: string, subObj: string  ): boolean => {
    // Style variable is present in the block substitution
    if(styVar in rel["subst"]) {
      // Style variable is bound to the substance object
      return (rel["subst"][styVar] == subObj);
    } else {
      throw new Error(`Style variable '${styVar}' not found in Style block at lines ${block.sel["start"].line}-${block.sel["end"].line}`);
    }
  }  


}

//type StyleDebugInfo<T> = {
//  blocks: StyleDebugInfoBlock<T>[];
//};
export type DebugStyleBlock<T> = {
  sel: Selector<unknown>;
  sats: DebugStyleBlockRel<T>[];
  unsats: DebugStyleBlockRel<T>[];
};
export type DebugStyleBlockRel<T> = {
  rel: RelationPatternSubst<T>;
  reasons: DebugReason[];
};
export type DebugReason = {
  code: DebugReasonCodes;
  srcRef: ISourceRef[];
  srcTxt?: string[];
};
export enum DebugReasonCodes {
  MATCHING_SUB_STATEMENTS_FOUND = "MATCHING_SUB_STATEMENTS_FOUND",
  NO_MATCHING_SUB_STATEMENTS = "NO_MATCHING_SUB_STATEMENTS",
}

// Mapping rule Registry
enum NameMapRules {
  SKIP,
  OP,
  VALUE,
  CONTENTS,
  CONTENTS_VALUE,
  TYPE_VALUE,
  TYPE_NAME_VALUE,
  NAME_VALUE,
  NAME_CONTENTS_VALUE,
  HEADER_CONTENTS_CONTENTS_VALUE,
  VARIABLE_VALUE,
  PROPERTY_PATH,
  FIELD_PATH,
  TAG,
}

// Structure for declaring rules that map AST nodes to Source Mappings
type AstSourceMap = {
  [k: string]: { map: NameMapRules; type?: SourceEntityType; subs: string[][] };
};

/**
 *
 * @param node  The AST Node to name
 * @param rule  Rule to apply to the node to extract its name
 * @returns
 */
const mapEntityName = (node: ASTNode<unknown>, rule: NameMapRules): string => {
  switch (rule) {
    case NameMapRules.SKIP:
      return "";
    case NameMapRules.OP:
      return node["op"];
    case NameMapRules.TAG:
      return node["tag"];
    case NameMapRules.VALUE:
      return node["value"];
    case NameMapRules.CONTENTS:
      return node["contents"];
    case NameMapRules.CONTENTS_VALUE:
      return node["contents"]["value"];
    case NameMapRules.TYPE_VALUE:
      return node["type"]["value"];
    case NameMapRules.TYPE_NAME_VALUE:
      return node["type"]["name"]["value"];
    case NameMapRules.NAME_VALUE:
      return node["name"]["value"];
    case NameMapRules.NAME_CONTENTS_VALUE:
      return node["name"]["contents"]["value"];
    case NameMapRules.HEADER_CONTENTS_CONTENTS_VALUE:
      return node["contents"]["contents"]["value"];
    case NameMapRules.VARIABLE_VALUE:
      return node["variable"]["value"];
    case NameMapRules.PROPERTY_PATH:
      return (
        node["name"]["contents"]["value"] +
        "." +
        node["field"]["value"] +
        "." +
        node["property"]["value"]
      );
    case NameMapRules.FIELD_PATH:
      return node["name"]["contents"]["value"] + "." + node["field"]["value"];
    default:
      throw new Error(`Unhandled mapEntityName type: ${rule}`);
  }
};

/**
 * Map shapes to their original source code
 *
 * TODO: The style piece should probably be here, but not the other parts.  !!!
 *
 * @param domProg
 * @param domSrc
 * @param subProg
 * @param subSrc
 * @param styProg
 * @param stySrc
 * @returns ShapeSourceMap
 */
export const mapShapesToSource = (
  domProg: DomainProg<unknown>,
  domSrc: string,
  subProg: SubProg<unknown>,
  subSrc: string,
  styProg: StyProg<unknown>,
  stySrc: string
): ShapeSourceMap => {
  // Create the source map
  const sourceMap: ShapeSourceMap = new ShapeSourceMap(domSrc, subSrc, stySrc);

  // ------------------------------------------------------------------------
  // Style: resolve GPIs to rules and Substance objects
  // ------------------------------------------------------------------------
  // Application of mapping rules to Style AST data for outputting Source Map
  const styAstMap: AstSourceMap = {
    StyProg: {
      map: NameMapRules.SKIP,
      subs: [["blocks"]],
    },
    HeaderBlock: {
      map: NameMapRules.TAG,
      type: SourceEntityType.STYLANG,
      subs: [["header"], ["block", "statements"]],
    },
    PathAssign: {
      map: NameMapRules.TAG,
      type: SourceEntityType.STYLANG,
      subs: [["path"], ["value"]],
    },
    Selector: {
      map: NameMapRules.TAG,
      type: SourceEntityType.STYLANG,
      subs: [["head"], ["where"]],
    },
    DeclPatterns: {
      map: NameMapRules.TAG,
      type: SourceEntityType.STYLANG,
      subs: [["contents"]],
    },
    DeclPattern: {
      map: NameMapRules.TYPE_VALUE,
      type: SourceEntityType.DOMTYPE,
      subs: [["id"]],
    },
    StyVar: {
      map: NameMapRules.CONTENTS_VALUE,
      type: SourceEntityType.STYVAR,
      subs: [],
    },
    LocalVar: {
      map: NameMapRules.CONTENTS_VALUE,
      type: SourceEntityType.STYLOCAL,
      subs: [],
    },
    RelationPatterns: {
      map: NameMapRules.TAG,
      type: SourceEntityType.STYLANG,
      subs: [["contents"]],
    },
    RelPred: {
      map: NameMapRules.NAME_VALUE,
      type: SourceEntityType.DOMPREDICATE, // !!! Always a predicate?
      subs: [["args"]],
    },
    SEBind: {
      map: NameMapRules.SKIP,
      subs: [["contents"]],
    },
    Fix: {
      map: NameMapRules.CONTENTS,
      type: SourceEntityType.STYNUMLIT,
      subs: [],
    },
    StringLit: {
      map: NameMapRules.CONTENTS,
      type: SourceEntityType.STYSTRLIT,
      subs: [],
    },
    InternalLocalVar: {
      map: NameMapRules.SKIP,
      subs: [],
    },
    ObjFn: {
      map: NameMapRules.NAME_VALUE,
      type: SourceEntityType.STYFUNCTION,
      subs: [["args"]],
    },
    ConstrFn: {
      map: NameMapRules.NAME_VALUE,
      type: SourceEntityType.STYFUNCTION,
      subs: [["args"]],
    },
    FieldPath: {
      map: NameMapRules.FIELD_PATH,
      type: SourceEntityType.STYLANG,
      subs: [],
    },
    GPIDecl: {
      map: NameMapRules.TAG,
      type: SourceEntityType.STYLANG,
      subs: [["shapeName"], ["properties"]],
    },
    Namespace: {
      map: NameMapRules.TAG,
      type: SourceEntityType.STYLANG,
      subs: [["contents"]],
    },
    Layering: {
      map: NameMapRules.TAG,
      type: SourceEntityType.STYLANG,
      subs: [["above"], ["below"]],
    },
    BinOp: {
      map: NameMapRules.OP,
      type: SourceEntityType.STYFUNCTION,
      subs: [["left"], ["right"]],
    },
    PropertyDecl: {
      map: NameMapRules.NAME_VALUE,
      type: SourceEntityType.STYPROPERTY,
      subs: [["value"]],
    },
    PropertyPath: {
      map: NameMapRules.PROPERTY_PATH,
      type: SourceEntityType.STYPROPERTY,
      subs: [],
    },
    Vector: {
      map: NameMapRules.TAG,
      type: SourceEntityType.STYLANG,
      subs: [["contents"]],
    },
    CompApp: {
      map: NameMapRules.NAME_VALUE,
      type: SourceEntityType.STYFUNCTION,
      subs: [["args"]],
    },
    Identifier: {
      map: NameMapRules.VALUE,
      type: SourceEntityType.STYVAR,
      subs: [],
    },
    AccessPath: {
      // Not Yet Implemented
      map: NameMapRules.SKIP,
      subs: [],
    },
    BoolLit: {
      map: NameMapRules.CONTENTS,
      type: SourceEntityType.STYBOOLIT,
      subs: [],
    },
    Override: {
      map: NameMapRules.TAG,
      type: SourceEntityType.STYLANG,
      subs: [["path"], ["value"]],
    },
    SubVar: {
      map: NameMapRules.CONTENTS_VALUE,
      type: SourceEntityType.SUBOBJECT,
      subs: [],
    },
    Delete: {
      map: NameMapRules.TAG,
      type: SourceEntityType.STYLANG,
      subs: [["contents"]],
    },
    Tuple: {
      map: NameMapRules.TAG,
      type: SourceEntityType.STYLANG,
      subs: [["contents"]],
    },
    List: {
      map: NameMapRules.TAG,
      type: SourceEntityType.STYLANG,
      subs: [["contents"]],
    },
    Vary: {
      map: NameMapRules.TAG,
      type: SourceEntityType.STYNUMVAR,
      subs: [],
    },
    VaryInit: {
      map: NameMapRules.CONTENTS,
      type: SourceEntityType.STYNUMVAR,
      subs: [],
    },
    UOp: {
      map: NameMapRules.OP,
      type: SourceEntityType.STYFUNCTION,
      subs: [["arg"]],
    },
    RelBind: {
      map: NameMapRules.TAG,
      type: SourceEntityType.STYLANG,
      subs: [["id"], ["expr"]],
    },
    SEFuncOrValCons: {
      map: NameMapRules.NAME_VALUE,
      type: SourceEntityType.STYVAR, // Not sure this is right
      subs: [["args"]],
    },
  };
  mapAstNodesToSource(styProg, styAstMap, SourceProgramType.STYLE, sourceMap);

  // ------------------------------------------------------------------------
  // Substance: resolve Substance objects to types and predicates
  //            TODO: Should probably be done in Substance compiler !!!
  // ------------------------------------------------------------------------
  // Application of mapping rules to AST data for outputting Source Map
  const subAstMap: AstSourceMap = {
    SubProg: {
      map: NameMapRules.SKIP,
      subs: [["statements"]],
    },
    Decl: {
      map: NameMapRules.NAME_VALUE,
      type: SourceEntityType.SUBOBJECT,
      subs: [],
    },
    ApplyPredicate: {
      map: NameMapRules.NAME_VALUE,
      type: SourceEntityType.SUBPREDICATE,
      subs: [["args"]],
    },
    Func: {
      map: NameMapRules.NAME_VALUE,
      type: SourceEntityType.SUBFUNCTION,
      subs: [["args"]],
    },
    Identifier: {
      map: NameMapRules.VALUE,
      type: SourceEntityType.SUBOBJECT,
      subs: [],
    },
    AutoLabel: {
      map: NameMapRules.SKIP,
      subs: [],
    },
    LabelDecl: {
      map: NameMapRules.TAG,
      type: SourceEntityType.SUBLABEL,
      subs: [["variable"]],
    },
    Bind: {
      map: NameMapRules.VARIABLE_VALUE,
      type: SourceEntityType.SUBOBJECT,
      subs: [["expr"]],
    },
    ApplyConstructor: {
      map: NameMapRules.NAME_VALUE,
      type: SourceEntityType.SUBCONSTRUCTOR,
      subs: [["args"]],
    },
    ApplyFunction: {
      map: NameMapRules.NAME_VALUE,
      type: SourceEntityType.SUBFUNCTION,
      subs: [["args"]],
    },
  };
  mapAstNodesToSource(
    subProg,
    subAstMap,
    SourceProgramType.SUBSTANCE,
    sourceMap
  );

  // ------------------------------------------------------------------------
  // Domain: Resolve predicates, functions, etc. to source locations
  //         TODO: Should probably be done in Domain compiler !!!
  // ------------------------------------------------------------------------
  // Application of mapping rules to AST data for outputting Source Map
  const domAstMap: AstSourceMap = {
    DomainProg: {
      map: NameMapRules.SKIP,
      subs: [["statements"]],
    },
    TypeDecl: {
      map: NameMapRules.NAME_VALUE,
      type: SourceEntityType.DOMTYPE,
      subs: [["params"], ["supertypes"]],
    },
    FunctionDecl: {
      map: NameMapRules.NAME_VALUE,
      type: SourceEntityType.DOMFUNCTION,
      subs: [["params"], ["args"], ["output"]],
    },
    ConstructorDecl: {
      map: NameMapRules.NAME_VALUE,
      type: SourceEntityType.DOMCONSTRUCTOR,
      subs: [["params"], ["args"], ["output"]],
    },
    PredicateDecl: {
      map: NameMapRules.NAME_VALUE,
      type: SourceEntityType.DOMPREDICATE,
      subs: [["params"], ["args"], ["output"]],
    },
    Arg: {
      map: NameMapRules.SKIP,
      subs: [["variable"], ["type"]],
    },
    TypeConstructor: {
      map: NameMapRules.SKIP,
      subs: [["name"], ["args"]],
    },
    TypeVar: {
      map: NameMapRules.SKIP,
      subs: [["name"]],
    },
    Identifier: {
      map: NameMapRules.VALUE,
      type: SourceEntityType.DOMTYPE,
      subs: [],
    },
    Prop: {
      map: NameMapRules.TAG,
      type: SourceEntityType.DOMPROP,
      subs: [],
    },
    SubTypeDecl: {
      // Not yet implemented
      map: NameMapRules.SKIP,
      subs: [],
    },
    PreludeDecl: {
      // Not yet implemented
      map: NameMapRules.SKIP,
      subs: [],
    },
    NotationDecl: {
      // Not yet implemented
      map: NameMapRules.SKIP,
      subs: [],
    },
  };
  mapAstNodesToSource(domProg, domAstMap, SourceProgramType.DOMAIN, sourceMap);

  return sourceMap;
};

/**
 * Map shapes to their original source code
 *
 * TODO: The style piece should probably be here, but not the other parts.  !!!
 *
 * @param ast AST to map to source statements
 * @param map Map of AST nodes to their original source code
 * @param pgmType Source Program Type (Style, Substance, Domain)
 * @param sourceMap
 * @returns ShapeSourceMap
 */
const mapAstNodesToSource = (
  ast: ASTNode<unknown>,
  map: AstSourceMap,
  pgmType: SourceProgramType,
  sourceMap: ShapeSourceMap
): ShapeSourceMap => {
  // Initially fill the stack with the list of AST block nodes
  const nodeStack: ASTNode<unknown>[] = [ast];
  while (nodeStack.length > 0) {
    // Pop item off the stack
    const node = nodeStack.pop() as ASTNode<unknown>;
    //console.log(`Processing AST node: ${node.tag}`);

    // Add any subnodes in this node to the stack for subsequent processing
    if (node.tag in map && "subs" in map[node.tag]) {
      map[node.tag].subs.forEach((sub: string[]) => {
        let nodesToAdd;
        switch (sub.length) {
          case 1:
            nodesToAdd = node[sub[0]];
            break;
          case 2:
            nodesToAdd = node[sub[0]][sub[1]];
            break;
          case 3:
            nodesToAdd = node[sub[0]][sub[1]][sub[2]];
            break;
          case 4:
            nodesToAdd = node[sub[0]][sub[1]][sub[2]][sub[3]];
            break;
          default:
            throw new Error(`Invalid sub node length: ${sub.length}`);
        }
        if (nodesToAdd !== undefined) {
          Array.isArray(nodesToAdd)
            ? nodeStack.push(...nodesToAdd.reverse())
            : nodeStack.push(nodesToAdd);
        }
      });

      // Map the node into the source map -- if needed
      const name: string = mapEntityName(node, map[node.tag].map);
      if (name !== "") {
        sourceMap.add(
          mapTemplate(pgmType, node, {
            type: map[node.tag].type,
            name: name,
          } as ISourceMapEntity)
        );
      }
    } else {
      console.log(` - Skipping unknown node: ${node.tag}`); // !!!
    }
  }

  return sourceMap;
};

/**
 * Helper function to generate a source map refernece from an AST Node
 *
 * @param origin Source Program Type (e.g., Style, Substance, Domain)
 * @param node AST Node to Process
 * @param entity Entity name and type
 * @returns ISourceRef
 */
export const mapTemplate = (
  origin: SourceProgramType,
  node: ASTNode<unknown>,
  entity: ISourceMapEntity
): ISourceRef => {
  if (!("start" in node)) {
    node["start"] = { line: 0, col: 0 };
  }
  if (!("end" in node)) {
    node["end"] = { line: 0, col: 0 };
  }
  return {
    entity: entity,
    origin: origin,
    lineStart: node["start"].line,
    lineEnd: node["end"].line,
    colStart: node["start"].col,
    colEnd: node["end"].col,
  };
};
