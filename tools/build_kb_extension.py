"""Adds the everyday-life activities (shopping, cafes, beer, fishing, cooking, gym, outdoors ...) to the knowledge base.
Only categories that Qloo returned places for (measured in Taipei, Tokyo and London) are listed here.
Idempotent: run again after editing. Then run tools/export_rules.py.
Needs for the new activities are proposals by the developer (source field says so); edit them freely.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
P = "urn:tag:category:place:"
# name: (zh, icon, tag, functions, keywords en+zh, vocabulary)
SPEC = {
 "Clothing store": ("服飾店", "👕", P+"clothing_store", ["shopping", "status_display"],
    ["clothing store", "streetwear", "apparel", "t-shirt", "fashion shop", "outfit", "服飾", "選貨", "穿搭", "T恤"],
    ["new arrivals", "lookbook", "sneakers and apparel", "select shop", "潮牌", "上新"]),
 "Vintage clothing store": ("古著店", "🧥", P+"vintage_clothing_store", ["shopping", "status_display"],
    ["vintage", "second-hand clothing", "secondhand clothes", "古著", "二手服", "中古服飾"], ["thrifted fashion", "retro clothes", "復古穿搭"]),
 "Boutique": ("選物店", "🛍️", P+"boutique", ["shopping", "status_display"],
    ["concept store", "select shop", "選物", "選貨店", "精品店"], ["curated goods", "designer goods", "設計選品"]),
 "Shoe store": ("鞋店", "👟", P+"shoe_store", ["shopping"],
    ["sneakers", "shoe store", "footwear", "球鞋", "鞋店", "運動鞋"], ["running shoes", "shoe release", "限量球鞋"]),
 "Toy store": ("玩具店", "🧸", P+"toy_store", ["shopping", "entertainment"],
    ["toy store", "action figure", "collectible toy", "玩具", "公仔", "盒玩", "模型玩具"], ["figures", "blind box", "plush", "扭蛋"]),
 "Collectibles store": ("收藏品店", "🃏", P+"collectibles_store", ["shopping", "entertainment"],
    ["trading card", "collectible", "collectibles", "卡牌", "收藏卡", "收藏品"], ["card game", "limited edition", "卡片收藏"]),
 "Gift shop": ("禮品與紀念品店", "🎁", P+"gift_shop", ["shopping"],
    ["gift shop", "souvenir", "souvenirs", "伴手禮", "紀念品", "文創", "禮品"], ["local specialty gifts", "creative goods", "在地特色禮物"]),
 "Jewelry store": ("飾品店", "💍", P+"jewelry_store", ["shopping", "status_display"],
    ["jewelry", "jewellery", "飾品", "珠寶"], ["rings and necklaces", "handmade accessories", "手作飾品"]),
 "Book store": ("書店", "📚", P+"book_store", ["quiet_solo", "culture", "shopping"],
    ["bookstore", "book store", "reading list", "書店", "選書", "獨立書店"], ["independent bookshop", "new books", "讀書會"]),
 "Stationery store": ("文具店", "✏️", P+"stationery_store", ["shopping", "quiet_solo"],
    ["stationery", "notebook shop", "文具", "手帳", "筆記本"], ["fountain pens", "planner", "鋼筆"]),
 "Craft store": ("手作材料店", "🧵", P+"craft_store", ["shopping", "quiet_solo"],
    ["craft store", "craft supplies", "handmade", "手作", "手工藝", "材料行"], ["sewing", "knitting", "pottery", "縫紉"]),
 "Department store": ("百貨公司", "🏬", P+"department_store", ["shopping"],
    ["department store", "百貨", "百貨公司", "周年慶"], ["anniversary sale", "mall brands", "專櫃"]),
 "Shopping mall": ("購物中心", "🛒", P+"shopping_mall", ["shopping", "entertainment"],
    ["shopping mall", "outlet mall", "商場", "購物中心"], ["indoor mall", "food court", "美食街"]),
 "Market": ("市集", "🧺", P+"market", ["shopping", "social"],
    ["farmers market", "flea market", "street market", "傳統市場", "市集", "跳蚤市場"], ["vendors", "weekend market", "創意市集"]),
 "Coffee shop": ("咖啡館", "☕", P+"coffee_shop", ["quiet_solo", "social"],
    ["coffee", "cafe", "café", "espresso", "咖啡", "咖啡廳", "手沖"], ["latte art", "pour over", "specialty coffee", "精品咖啡"]),
 "Tea house": ("茶館", "🍵", P+"tea_house", ["quiet_solo", "mental_comfort"],
    ["tea house", "teahouse", "tea ceremony", "茶館", "茶藝", "茶席"], ["oolong", "gongfu tea", "品茶"]),
 "Bakery": ("烘焙坊", "🥐", P+"bakery", ["social", "quick_meal"],
    ["bakery", "bread", "pastry", "croissant", "麵包", "烘焙", "可頌"], ["sourdough", "baked goods", "吐司"]),
 "Dessert shop": ("甜點店", "🍰", P+"dessert_shop", ["social", "entertainment"],
    ["dessert", "cake", "ice cream", "甜點", "蛋糕", "冰品"], ["patisserie", "shaved ice", "豆花"]),
 "Bubble tea store": ("手搖飲店", "🧋", P+"bubble_tea_store", ["quick_meal", "social"],
    ["bubble tea", "boba", "milk tea", "手搖", "珍奶", "珍珠奶茶", "手搖飲"], ["tapioca", "tea shop", "飲料店"]),
 "Brunch restaurant": ("早午餐店", "🍳", P+"brunch_restaurant", ["social"],
    ["brunch", "早午餐"], ["eggs benedict", "pancakes", "鬆餅"]),
 "Vegetarian restaurant": ("蔬食餐廳", "🥗", P+"vegetarian_restaurant", ["social"],
    ["vegetarian", "vegan", "plant-based", "蔬食", "素食"], ["meatless", "vegetable dishes", "植物肉"]),
 "Yakiniku restaurant": ("燒肉店", "🥩", P+"yakiniku_restaurant", ["social"],
    ["yakiniku", "korean bbq", "bbq", "燒肉", "烤肉"], ["grilled meat", "wagyu grill", "和牛"]),
 "Sushi restaurant": ("壽司店", "🍣", P+"sushi_restaurant", ["social"],
    ["sushi", "壽司", "握壽司", "sashimi", "生魚片"], ["nigiri", "conveyor belt sushi", "迴轉壽司"]),
 "Pub": ("酒館", "🍺", P+"pub", ["social", "mental_comfort"],
    ["pub", "tavern", "酒館", "居酒屋"], ["draft beer", "bar snacks", "生啤酒"]),
 "Brewery": ("啤酒廠與精釀", "🍻", P+"brewery", ["social", "mental_comfort"],
    ["brewery", "craft beer", "hazy ipa", "stout", "精釀", "啤酒", "啤酒瘋"], ["hazy ipa", "taproom", "brewing", "麥芽"]),
 "Beer store": ("啤酒專賣店", "🍺", P+"beer_store", ["shopping", "social"],
    ["beer store", "bottle shop", "啤酒專賣", "啤酒專賣店"], ["craft beer bottles", "beer selection", "酒瓶店"]),
 "Beer garden": ("啤酒花園", "🍻", P+"beer_garden", ["social"],
    ["beer garden", "啤酒花園", "啤酒屋"], ["outdoor beer", "bier garten", "露天啤酒"]),
 "Night club": ("夜店", "🪩", P+"night_club", ["social", "entertainment"],
    ["nightclub", "night club", "dj set", "夜店", "舞廳"], ["clubbing", "dance floor", "電音派對"]),
 "Karaoke bar": ("KTV 與卡拉OK", "🎤", P+"karaoke_bar", ["social", "stress_relief", "entertainment"],
    ["karaoke", "ktv", "卡拉ok", "唱歌"], ["singing room", "sing along", "包廂唱歌"]),
 "Live music venue": ("Live House 展演空間", "🎸", P+"live_music_venue", ["entertainment", "social"],
    ["live house", "live music", "現場演出", "展演空間", "音樂祭"], ["indie gig", "band show", "樂團演出"]),
 "Movie theater": ("電影院", "🎬", P+"movie_theater", ["entertainment"],
    ["movie theater", "cinema", "電影院", "戲院", "imax"], ["premiere", "film screening", "首映"]),
 "Cooking class": ("料理課", "👩‍🍳", P+"cooking_class", ["learning", "social"],
    ["cooking class", "cooking workshop", "recipe", "recipes", "烹飪課", "料理課", "食譜", "做菜", "家常菜"], ["home cooking", "meal prep", "功夫菜"]),
 "Kitchen supply store": ("廚具店", "🍳", P+"kitchen_supply_store", ["shopping"],
    ["kitchenware", "cookware", "kitchen supply", "廚具", "鍋具"], ["knives", "air fryer", "鑄鐵鍋"]),
 "Butcher shop": ("肉舖", "🥩", P+"butcher_shop", ["shopping"],
    ["butcher", "meat", "steak", "肉品", "肉舖", "牛排"], ["dry aged beef", "cuts of beef", "牛肉進口"]),
 "Hiking area": ("登山步道", "🥾", P+"hiking_area", ["outdoors", "stress_relief", "social"],
    ["hiking", "hiking trail", "trekking", "登山", "步道", "健行"], ["mountain trail", "summit", "百岳"]),
 "Yoga studio": ("瑜伽教室", "🧘", P+"yoga_studio", ["mental_comfort", "quiet_solo", "physical_repair"],
    ["yoga", "瑜伽", "vinyasa"], ["stretching", "breathwork", "伸展"]),
 "Gym": ("健身房", "🏋️", P+"gym", ["stress_relief", "physical_repair"],
    ["gym", "weight training", "strength training", "workout", "重訓", "健身", "增肌"], ["squat", "deadlift", "bodybuilding", "肌力訓練"]),
 "Sports club": ("運動中心與俱樂部", "🏅", P+"sports_club", ["social", "stress_relief"],
    ["sports club", "sports center", "運動中心", "運動俱樂部"], ["community sports", "court rental", "場地租借"]),
 "Sporting goods store": ("運動用品店", "🎽", P+"sporting_goods_store", ["shopping"],
    ["sporting goods", "sports shop", "運動用品", "球拍", "racket shop"], ["racket stringing", "sports equipment", "穿線"]),
 "Outdoor sports store": ("戶外用品店", "🧗", P+"outdoor_sports_store", ["shopping", "outdoors"],
    ["outdoor gear", "camping gear", "戶外用品", "露營用品"], ["tents", "hiking boots", "登山裝備"]),
 "Fishing store": ("釣具店", "🎣", P+"fishing_store", ["outdoors", "quiet_solo", "shopping"],
    ["fishing", "fishing tackle", "lure fishing", "fly fishing", "釣魚", "路亞", "毛鉤", "釣具"], ["rods and reels", "angling", "漁獲"]),
 "Physical therapist": ("物理治療所", "🩺", P+"physical_therapist", ["physical_repair"],
    ["physiotherapy", "physical therapy", "physiotherapist", "物理治療", "復健"], ["sports injury", "rehabilitation", "運動傷害", "肩頸"]),
 "Health food store": ("健康食品店", "🥦", P+"health_food_store", ["shopping", "physical_repair"],
    ["health food", "dietary supplement", "protein powder", "保健食品", "蛋白粉"], ["nutrition", "vitamins", "營養補給"]),
 "Squash court": ("壁球場", "🏸", P+"squash_court", ["social", "stress_relief", "skill_display"],
    ["squash", "壁球", "squash court"], ["rallies", "glass court", "壁球館", "對打"]),
 "Table tennis": ("桌球", "🏓", P+"table_tennis_facility", ["social", "stress_relief", "skill_display"],
    ["table tennis", "ping pong", "桌球", "乒乓球", "乒乓"], ["paddle rubber", "spin serve", "桌球館", "發球"]),
 "Rock climbing gym": ("攀岩館", "🧗", P+"rock_climbing_gym", ["social", "stress_relief", "skill_display"],
    ["rock climbing", "bouldering", "climbing gym", "攀岩", "抱石"], ["belay", "crimps", "route setting", "岩館"]),
 "Escape room": ("密室逃脫", "🔐", P+"escape_room_center", ["social", "entertainment"],
    ["escape room", "密室逃脫", "密室", "劇本殺"], ["puzzle rooms", "team puzzle", "解謎"]),
 "Go-karting": ("卡丁車", "🏎️", P+"go_karting_venue", ["social", "entertainment", "skill_display"],
    ["go-kart", "go kart", "karting", "卡丁車"], ["lap times", "race track", "賽車"]),
 "Diving center": ("潛水中心", "🤿", P+"diving_center", ["outdoors", "skill_display"],
    ["scuba", "scuba diving", "freediving", "潛水", "浮潛"], ["open water", "dive trip", "水肺"]),
 "Archery range": ("射箭場", "🏹", P+"archery_range", ["skill_display", "stress_relief", "social"],
    ["archery", "bow shooting", "射箭"], ["recurve", "target shooting", "弓箭"]),
 "Art gallery": ("藝廊", "🎨", P+"art_gallery", ["culture", "quiet_solo"],
    ["art gallery", "藝廊", "畫廊"], ["opening night", "contemporary art", "當代藝術"]),
}
kbp = ROOT / "kb" / "activities.json"
kb = json.loads(kbp.read_text())
have = {a["activity"] for a in kb}
for name, (zh, icon, tag, funcs, kws, vocab) in SPEC.items():
    entry = {"activity": name, "functions": funcs, "source": "developer proposal (needs mapping); tag measured in Qloo", "tag_id": tag, "keywords": kws}
    if name in have:
        for a in kb:
            if a["activity"] == name: a.update(entry)
    else:
        kb.append(entry)
kbp.write_text(json.dumps(kb, ensure_ascii=False, indent=1))
i18np = ROOT / "kb" / "i18n.json"; i18n = json.loads(i18np.read_text())
for name, v in SPEC.items(): i18n["activities"][name] = {"zh": v[0]}
i18n["needs"]["shopping"] = {"en": "Shopping and finds", "zh": "逛街挖寶"}
i18n["needs"]["outdoors"] = {"en": "Outdoors", "zh": "親近戶外"}
i18n["needs"]["learning"] = {"en": "Learn something", "zh": "學點新東西"}
i18np.write_text(json.dumps(i18n, ensure_ascii=False, indent=1))
vp = ROOT / "kb" / "vocab.json"; vocab = json.loads(vp.read_text())
for name, v in SPEC.items(): vocab[name] = sorted(set(vocab.get(name, []) + v[5] + v[4]))
vp.write_text(json.dumps(vocab, ensure_ascii=False, indent=1))
print("activities now:", len(kb), "| new or updated:", len(SPEC))
