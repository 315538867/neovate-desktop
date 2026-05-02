import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "../../../lib/utils";
import { useQueryStatus } from "../hooks/use-query-status";

// [gerund, pastTense] pairs — full set from Claude Code CLI
export const VERBS: [string, string][] = [
  ["Accomplishing", "Accomplished"],
  ["Actioning", "Actioned"],
  ["Actualizing", "Actualized"],
  ["Architecting", "Architected"],
  ["Baking", "Baked"],
  ["Beaming", "Beamed"],
  ["Beboppin'", "Bebopped"],
  ["Befuddling", "Befuddled"],
  ["Billowing", "Billowed"],
  ["Blanching", "Blanched"],
  ["Bloviating", "Bloviated"],
  ["Boogieing", "Boogied"],
  ["Boondoggling", "Boondoggled"],
  ["Booping", "Booped"],
  ["Bootstrapping", "Bootstrapped"],
  ["Brewing", "Brewed"],
  ["Bunning", "Bunned"],
  ["Burrowing", "Burrowed"],
  ["Calculating", "Calculated"],
  ["Canoodling", "Canoodled"],
  ["Caramelizing", "Caramelized"],
  ["Cascading", "Cascaded"],
  ["Catapulting", "Catapulted"],
  ["Cerebrating", "Cerebrated"],
  ["Channeling", "Channeled"],
  ["Channelling", "Channelled"],
  ["Choreographing", "Choreographed"],
  ["Churning", "Churned"],
  ["Clauding", "Clauded"],
  ["Coalescing", "Coalesced"],
  ["Cogitating", "Cogitated"],
  ["Combobulating", "Combobulated"],
  ["Composing", "Composed"],
  ["Computing", "Computed"],
  ["Concocting", "Concocted"],
  ["Considering", "Considered"],
  ["Contemplating", "Contemplated"],
  ["Cooking", "Cooked"],
  ["Crafting", "Crafted"],
  ["Creating", "Created"],
  ["Crunching", "Crunched"],
  ["Crystallizing", "Crystallized"],
  ["Cultivating", "Cultivated"],
  ["Deciphering", "Deciphered"],
  ["Deliberating", "Deliberated"],
  ["Determining", "Determined"],
  ["Dilly-dallying", "Dilly-dallied"],
  ["Discombobulating", "Discombobulated"],
  ["Doing", "Done"],
  ["Doodling", "Doodled"],
  ["Drizzling", "Drizzled"],
  ["Ebbing", "Ebbed"],
  ["Effecting", "Effected"],
  ["Elucidating", "Elucidated"],
  ["Embellishing", "Embellished"],
  ["Enchanting", "Enchanted"],
  ["Envisioning", "Envisioned"],
  ["Evaporating", "Evaporated"],
  ["Fermenting", "Fermented"],
  ["Fiddle-faddling", "Fiddle-faddled"],
  ["Finagling", "Finagled"],
  ["Flambéing", "Flambéed"],
  ["Flibbertigibbeting", "Flibbertigibbeted"],
  ["Flowing", "Flowed"],
  ["Flummoxing", "Flummoxed"],
  ["Fluttering", "Fluttered"],
  ["Forging", "Forged"],
  ["Forming", "Formed"],
  ["Frolicking", "Frolicked"],
  ["Frosting", "Frosted"],
  ["Gallivanting", "Gallivanted"],
  ["Galloping", "Galloped"],
  ["Garnishing", "Garnished"],
  ["Generating", "Generated"],
  ["Gesticulating", "Gesticulated"],
  ["Germinating", "Germinated"],
  ["Gitifying", "Gitified"],
  ["Grooving", "Grooved"],
  ["Gusting", "Gusted"],
  ["Harmonizing", "Harmonized"],
  ["Hashing", "Hashed"],
  ["Hatching", "Hatched"],
  ["Herding", "Herded"],
  ["Honking", "Honked"],
  ["Hullaballooing", "Hullaballooed"],
  ["Hyperspacing", "Hyperspaced"],
  ["Ideating", "Ideated"],
  ["Imagining", "Imagined"],
  ["Improvising", "Improvised"],
  ["Incubating", "Incubated"],
  ["Inferring", "Inferred"],
  ["Infusing", "Infused"],
  ["Ionizing", "Ionized"],
  ["Jitterbugging", "Jitterbugged"],
  ["Julienning", "Julienned"],
  ["Kneading", "Kneaded"],
  ["Leavening", "Leavened"],
  ["Levitating", "Levitated"],
  ["Lollygagging", "Lollygagged"],
  ["Manifesting", "Manifested"],
  ["Marinating", "Marinated"],
  ["Meandering", "Meandered"],
  ["Metamorphosing", "Metamorphosed"],
  ["Misting", "Misted"],
  ["Moonwalking", "Moonwalked"],
  ["Moseying", "Moseyed"],
  ["Mulling", "Mulled"],
  ["Mustering", "Mustered"],
  ["Musing", "Mused"],
  ["Nebulizing", "Nebulized"],
  ["Nesting", "Nested"],
  ["Newspapering", "Newspapered"],
  ["Noodling", "Noodled"],
  ["Nucleating", "Nucleated"],
  ["Orbiting", "Orbited"],
  ["Orchestrating", "Orchestrated"],
  ["Osmosing", "Osmosed"],
  ["Perambulating", "Perambulated"],
  ["Percolating", "Percolated"],
  ["Perusing", "Perused"],
  ["Philosophising", "Philosophised"],
  ["Photosynthesizing", "Photosynthesized"],
  ["Pollinating", "Pollinated"],
  ["Pondering", "Pondered"],
  ["Pontificating", "Pontificated"],
  ["Pouncing", "Pounced"],
  ["Precipitating", "Precipitated"],
  ["Prestidigitating", "Prestidigitated"],
  ["Processing", "Processed"],
  ["Proofing", "Proofed"],
  ["Propagating", "Propagated"],
  ["Puttering", "Puttered"],
  ["Puzzling", "Puzzled"],
  ["Quantumizing", "Quantumized"],
  ["Razzle-dazzling", "Razzle-dazzled"],
  ["Razzmatazzing", "Razzmatazzed"],
  ["Recombobulating", "Recombobulated"],
  ["Reticulating", "Reticulated"],
  ["Roosting", "Roosted"],
  ["Ruminating", "Ruminated"],
  ["Sautéing", "Sautéed"],
  ["Scampering", "Scampered"],
  ["Schlepping", "Schlepped"],
  ["Scurrying", "Scurried"],
  ["Seasoning", "Seasoned"],
  ["Shenaniganing", "Shenaniganed"],
  ["Shimmying", "Shimmied"],
  ["Simmering", "Simmered"],
  ["Skedaddling", "Skedaddled"],
  ["Sketching", "Sketched"],
  ["Slithering", "Slithered"],
  ["Smooshing", "Smooshed"],
  ["Sock-hopping", "Sock-hopped"],
  ["Spelunking", "Spelunked"],
  ["Spinning", "Spun"],
  ["Sprouting", "Sprouted"],
  ["Stewing", "Stewed"],
  ["Sublimating", "Sublimated"],
  ["Swirling", "Swirled"],
  ["Swooping", "Swooped"],
  ["Symbioting", "Symbioted"],
  ["Synthesizing", "Synthesized"],
  ["Tempering", "Tempered"],
  ["Thinking", "Thought"],
  ["Thundering", "Thundered"],
  ["Tinkering", "Tinkered"],
  ["Tomfoolering", "Tomfoolered"],
  ["Topsy-turvying", "Topsy-turvied"],
  ["Transfiguring", "Transfigured"],
  ["Transmuting", "Transmuted"],
  ["Twisting", "Twisted"],
  ["Undulating", "Undulated"],
  ["Unfurling", "Unfurled"],
  ["Unravelling", "Unravelled"],
  ["Vibing", "Vibed"],
  ["Waddling", "Waddled"],
  ["Wandering", "Wandered"],
  ["Warping", "Warped"],
  ["Whatchamacalliting", "Whatchamacallited"],
  ["Whirlpooling", "Whirlpooled"],
  ["Whirring", "Whirred"],
  ["Whisking", "Whisked"],
  ["Wibbling", "Wibbled"],
  ["Working", "Worked"],
  ["Wrangling", "Wrangled"],
  ["Zesting", "Zested"],
  ["Zigzagging", "Zigzagged"],
];

// 中文动词对，与 VERBS 1:1 对齐索引。当 locale 为 zh-CN 时使用。
export const VERBS_ZH: [string, string][] = [
  ["完成中", "已完成"],
  ["行动中", "已行动"],
  ["实现中", "已实现"],
  ["架构中", "已架构"],
  ["烘焙中", "已烘焙"],
  ["闪耀中", "已闪耀"],
  ["蹦跶中", "蹦跶完毕"],
  ["困惑中", "已困惑"],
  ["翻涌中", "已翻涌"],
  ["焯水中", "已焯水"],
  ["长篇大论中", "长篇大论完毕"],
  ["摇摆中", "已摇摆"],
  ["瞎忙活中", "瞎忙活完毕"],
  ["戳戳中", "戳过了"],
  ["引导中", "已引导"],
  ["酿造中", "已酿造"],
  ["打包中", "已打包"],
  ["钻研中", "已钻研"],
  ["计算中", "已计算"],
  ["卿卿我我中", "卿卿我我完毕"],
  ["焦糖化中", "焦糖化完毕"],
  ["层叠中", "已层叠"],
  ["弹射中", "已弹射"],
  ["思索中", "已思索"],
  ["沟通中", "已沟通"],
  ["传导中", "已传导"],
  ["编排中", "已编排"],
  ["搅拌中", "已搅拌"],
  ["Claude 中", "Claude 完毕"],
  ["凝聚中", "已凝聚"],
  ["冥思中", "已冥思"],
  ["整理中", "已整理"],
  ["谱写中", "已谱写"],
  ["演算中", "已演算"],
  ["调制中", "已调制"],
  ["考虑中", "已考虑"],
  ["沉思中", "已沉思"],
  ["烹饪中", "已烹饪"],
  ["雕琢中", "已雕琢"],
  ["创造中", "已创造"],
  ["嘎吱嘎吱中", "嘎吱完毕"],
  ["结晶中", "已结晶"],
  ["培育中", "已培育"],
  ["解码中", "已解码"],
  ["商议中", "已商议"],
  ["判定中", "已判定"],
  ["磨磨蹭蹭中", "磨蹭完毕"],
  ["七荤八素中", "七荤八素完毕"],
  ["干活中", "干完了"],
  ["涂鸦中", "已涂鸦"],
  ["淋洒中", "已淋洒"],
  ["退潮中", "已退潮"],
  ["落实中", "已落实"],
  ["阐释中", "已阐释"],
  ["修饰中", "已修饰"],
  ["施魔法中", "已施魔法"],
  ["构想中", "已构想"],
  ["蒸发中", "已蒸发"],
  ["发酵中", "已发酵"],
  ["拨弄中", "拨弄完毕"],
  ["撺掇中", "已撺掇"],
  ["火焰���理中", "火焰料理完毕"],
  ["心猿意马中", "心猿意马完毕"],
  ["流淌中", "已流淌"],
  ["一头雾水中", "雾水散去"],
  ["飘动中", "已飘动"],
  ["锻造中", "已锻造"],
  ["成型中", "已成型"],
  ["嬉戏中", "已嬉戏"],
  ["撒糖霜中", "糖霜已撒"],
  ["闲逛中", "已闲逛"],
  ["飞奔中", "已飞奔"],
  ["装点中", "已装点"],
  ["生成中", "已生成"],
  ["比划中", "比划完毕"],
  ["萌芽中", "已萌芽"],
  ["Git 中", "Git 完毕"],
  ["律动中", "已律动"],
  ["阵风中", "阵风已过"],
  ["调和中", "已调和"],
  ["散列中", "已散列"],
  ["孵化中", "已孵化"],
  ["放牧中", "已放牧"],
  ["鸣笛中", "已鸣笛"],
  ["闹哄哄中", "闹哄哄完毕"],
  ["超空间跃迁中", "超空间跃迁完毕"],
  ["构思中", "已构思"],
  ["想象中", "已想象"],
  ["即兴中", "已即兴"],
  ["培养中", "已培养"],
  ["推理中", "已推理"],
  ["注入中", "已注入"],
  ["电离中", "已电离"],
  ["吉特巴中", "吉特巴完毕"],
  ["切丝中", "已切丝"],
  ["揉面中", "已揉面"],
  ["醒发中", "已醒发"],
  ["悬浮中", "已悬浮"],
  ["闲晃中", "闲晃完毕"],
  ["显化中", "已显化"],
  ["腌制中", "已腌制"],
  ["蜿蜒前行中", "已蜿蜒"],
  ["蜕变中", "已蜕变"],
  ["起雾中", "已起雾"],
  ["太空步中", "太空步完毕"],
  ["慢悠悠中", "慢悠悠完毕"],
  ["琢磨中", "已琢磨"],
  ["集结中", "已集结"],
  ["沉吟中", "已沉吟"],
  ["雾化中", "已雾化"],
  ["筑巢中", "已筑巢"],
  ["翻报纸中", "翻完报纸"],
  ["瞎搞中", "瞎搞完毕"],
  ["成核中", "已成核"],
  ["绕轨中", "已绕轨"],
  ["协奏中", "已协奏"],
  ["渗透中", "已渗透"],
  ["漫步中", "已漫步"],
  ["渗滤中", "已渗滤"],
  ["翻阅中", "已翻阅"],
  ["哲思中", "已哲��"],
  ["光合作用中", "光合作用完毕"],
  ["授粉中", "已授粉"],
  ["思量中", "已思量"],
  ["高谈阔论中", "高谈阔论完毕"],
  ["扑抓中", "扑抓完毕"],
  ["析出中", "已析出"],
  ["戏法变变中", "戏法变完"],
  ["流转中", "已流转"],
  ["校样中", "已校样"],
  ["传播中", "已传播"],
  ["鼓捣中", "鼓捣完毕"],
  ["迷惑中", "已迷惑"],
  ["量子化中", "已量子化"],
  ["眼花缭乱中", "眼花缭乱完毕"],
  ["排场十足中", "排场十足完毕"],
  ["重新整理中", "已重新整理"],
  ["网格化中", "已网格化"],
  ["栖息中", "已栖息"],
  ["反刍中", "已反刍"],
  ["煎炒中", "已煎炒"],
  ["蹦跳中", "已蹦跳"],
  ["拖运中", "已拖运"],
  ["疾走中", "已疾走"],
  ["调味中", "已调味"],
  ["折腾中", "折腾完毕"],
  ["扭动中", "已扭动"],
  ["慢炖中", "已慢炖"],
  ["溜走中", "已溜走"],
  ["速写中", "已速写"],
  ["滑行中", "已滑行"],
  ["挤压中", "已挤压"],
  ["摇摆舞中", "摇摆舞完毕"],
  ["探洞中", "探洞完毕"],
  ["旋转中", "已旋转"],
  ["抽芽中", "已抽芽"],
  ["焖煮中", "已焖煮"],
  ["升华中", "已升华"],
  ["涡动中", "已涡动"],
  ["俯冲中", "已俯冲"],
  ["共生中", "已共生"],
  ["合成中", "已合成"],
  ["调温中", "已调温"],
  ["思考中", "已思考"],
  ["雷鸣中", "已雷鸣"],
  ["修补中", "已修补"],
  ["胡闹中", "胡闹完毕"],
  ["天翻地覆中", "天翻地覆完毕"],
  ["变形中", "已变形"],
  ["嬗变中", "已嬗变"],
  ["拧动中", "已拧动"],
  ["起伏中", "已起伏"],
  ["展开中", "已展开"],
  ["解开中", "已解开"],
  ["享受氛围中", "氛围完毕"],
  ["摇摇晃晃中", "摇晃完毕"],
  ["漫游中", "已漫游"],
  ["弯折中", "已弯折"],
  ["那啥中", "那啥完毕"],
  ["涡漩中", "涡漩完毕"],
  ["嗡鸣中", "已嗡鸣"],
  ["搅打中", "已搅打"],
  ["颤动中", "已颤动"],
  ["工作中", "已工作"],
  ["摆弄中", "已摆弄"],
  ["提味中", "已提味"],
  ["之字形中", "之字形完毕"],
];

/**
 * 根据当前 locale 选择动词列表。
 * 中文环境返回 VERBS_ZH，其他返回英文 VERBS。
 */
export function getVerbs(locale: string | undefined): [string, string][] {
  return locale && locale.toLowerCase().startsWith("zh") ? VERBS_ZH : VERBS;
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ${s % 60}s`;
}

function formatThinkingDuration(ms: number): string {
  return `${Math.max(1, Math.round(ms / 1000))}s`;
}

export function QueryStatus({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const status = useQueryStatus(sessionId);
  const hasBeenActiveRef = useRef(false);

  if (status.phase !== "idle") {
    hasBeenActiveRef.current = true;
  }

  // Before first activation, render nothing — the first appearance happens
  // when the user sends a message, so that layout shift is expected.
  if (!hasBeenActiveRef.current) return null;

  const isIdle = status.phase === "idle";
  const isCompleting = status.phase === "completing";

  // Build the detail parts inside parentheses
  const details: string[] = [];
  details.push(formatElapsed(status.elapsedMs));
  if (status.isThinking) {
    // will be rendered separately with animation
  } else if (status.thinkingDurationMs !== null && status.thinkingDurationMs > 0) {
    details.push(
      t("chat.queryStatus.thoughtFor", {
        duration: formatThinkingDuration(status.thinkingDurationMs),
      }),
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-3 py-1 text-xs transition-opacity duration-300",
        isIdle ? "invisible" : isCompleting ? "opacity-0" : "opacity-100",
      )}
    >
      <span
        className={cn(
          "font-mono",
          status.isStalled ? "text-destructive/60" : "text-muted-foreground",
        )}
      >
        {status.spinnerFrame}
      </span>
      <span className="text-muted-foreground">
        {isCompleting ? (
          <>
            {t("chat.queryStatus.completedFor", {
              verb: status.pastVerb,
              duration: formatElapsed(status.elapsedMs),
            })}
          </>
        ) : (
          <>
            {status.verb}…{" "}
            <span className="text-muted-foreground/70">
              ({details.join(" · ")}
              {status.isThinking && (
                <span className="animate-pulse"> · {t("chat.queryStatus.thinking")}</span>
              )}
              )
            </span>
          </>
        )}
      </span>
    </div>
  );
}
