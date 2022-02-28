const { cache } = require('./cache');

describe('cache tests', () => {
  beforeEach(() => {
    cache.clear();
  });

  afterEach(() => {
    cache.clear();
  });
  it('test cache hits', () => {
    keys = [
      'nMKmBSS9b06SwibDptXMETV8Sg8ctoSOQcTpNEBleubwPRQz3BhXGsQTRUBE',
      'DhTA4CNFiHWvam19grpjcSdtAKmjSHrMRAaWHU8xMFxvdKmFXLw16aZCXDX5',
      'V69hqnl3ZdZU5zAmuy7ZWCfT6zK14pqIbQ6Rna6hyD7tZ2J4hvxTrAsQ2mfy',
      'WIFdTRgyI5IbvmWOcg1ATKaxvBM2XR1bsDnlSfBBmOQtvOid4KmfuChLgyzQ',
      'a0SLRWTod5LV10ZocsE3R9BD1QYoCHKQnKLkXsREZP0xyalG2UT9HnMNTHOM',
      '텙蝢k򈜵텒Q􆄙=󡾰𡄡d򭸣򰱰󜾜Ġ޾򴊫ꨙ؞𱤄wَ뢉񧇆Tܪyڀ쌿b3ꘓળEɕ澟񹼍㎱򔜉6𼴾鑡򤹨Ӥ+k҄',
      '득׎ֹ쬒Ȫξ󭁓쀞J񤦽쮇㊝]򛇑󲮰yȆل8h󇐈桸󲦌񧝰񫸲𻃲跖Ə͟(󗄀렸B寖Z�򭏂𪂿Έ󷱾օ԰󞴫򖈟b񫑷򜐄',
      '빽𪔎g̊嵹꭫⅜=좄񞀎񑈭꒻_̎ꀴ+꼺̦⹡󭴶Y�̌񾄀º닾􁢙鉢ӿاщ=򰮍計+򺰻񉳫岍3XၜŢ혏ꙟ󿩸´t򤸤',
      '�N偮󟪁≄fba򲌂9ȍ񯒴ʝ쩦傌􊹅圛c𼳑1󕸿ׁ⦖κa쵋󈓭ꔻ㢕팲ꕣd񚀯ǶᎵ􁎉Ү󖕬o𠫎򩴍ҿ𾄠򇂗񰡸뽕䫧',
      "`眚ԧ�𚈂󟇏ҕ3'̔@ೈխ䬮#a爲񥕠ŝm쵀𥆋큢Κr׹뫝ڕ鈼죠6⪔ћ܍򣭔̨߶_󘵲ܺ졤򞏻址⪹k񚙝󨭯󵬐",
    ];

    keys.forEach((key) => cache.set(key, key));
    keys.forEach((key) => {
      expect(cache.get(key)).toBe(key);
      expect(cache.has(key)).toBe(true);
    });
  });

  it('test cache not available', () => {
    keys = [
      'nMKmBSS9b06SwibDptXMETV8Sg8ctoSOQcTpNEBleubwPRQz3BhXGsQTRUBE',
      'DhTA4CNFiHWvam19grpjcSdtAKmjSHrMRAaWHU8xMFxvdKmFXLw16aZCXDX5',
      'V69hqnl3ZdZU5zAmuy7ZWCfT6zK14pqIbQ6Rna6hyD7tZ2J4hvxTrAsQ2mfy',
      'WIFdTRgyI5IbvmWOcg1ATKaxvBM2XR1bsDnlSfBBmOQtvOid4KmfuChLgyzQ',
      'a0SLRWTod5LV10ZocsE3R9BD1QYoCHKQnKLkXsREZP0xyalG2UT9HnMNTHOM',
      '텙蝢k򈜵텒Q􆄙=󡾰𡄡d򭸣򰱰󜾜Ġ޾򴊫ꨙ؞𱤄wَ뢉񧇆Tܪyڀ쌿b3ꘓળEɕ澟񹼍㎱򔜉6𼴾鑡򤹨Ӥ+k҄',
      '득׎ֹ쬒Ȫξ󭁓쀞J񤦽쮇㊝]򛇑󲮰yȆل8h󇐈桸󲦌񧝰񫸲𻃲跖Ə͟(󗄀렸B寖Z�򭏂𪂿Έ󷱾օ԰󞴫򖈟b񫑷򜐄',
      '빽𪔎g̊嵹꭫⅜=좄񞀎񑈭꒻_̎ꀴ+꼺̦⹡󭴶Y�̌񾄀º닾􁢙鉢ӿاщ=򰮍計+򺰻񉳫岍3XၜŢ혏ꙟ󿩸´t򤸤',
      '�N偮󟪁≄fba򲌂9ȍ񯒴ʝ쩦傌􊹅圛c𼳑1󕸿ׁ⦖κa쵋󈓭ꔻ㢕팲ꕣd񚀯ǶᎵ􁎉Ү󖕬o𠫎򩴍ҿ𾄠򇂗񰡸뽕䫧',
      "`眚ԧ�𚈂󟇏ҕ3'̔@ೈխ䬮#a爲񥕠ŝm쵀𥆋큢Κr׹뫝ڕ鈼죠6⪔ћ܍򣭔̨߶_󘵲ܺ졤򞏻址⪹k񚙝󨭯󵬐",
    ];

    keys.forEach((key) => {
      expect(cache.get(key)).toBe(undefined);
      expect(cache.has(key)).toBe(false);
    });
  });
});
