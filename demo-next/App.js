import React, { useMemo, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

const C = {
  bg: '#F7F8FA', surface: '#FFFFFF', text: '#17191C', muted: '#667085', brand: '#8E9AAF',
  green: '#00E676', blue: '#00B0FF', red: '#E5484D', warning: '#F5A524', border: '#E7E9ED', soft: '#EEF1F5'
};

const tabs = [
  ['home','Главная','home-outline'], ['map','Карта','map-outline'], ['pay','Покупка','scan-outline'],
  ['wallet','Кошелёк','wallet-outline'], ['profile','Профиль','person-outline']
];

const partners = [
  { name: 'Green Kitchen', category: 'Рестораны', discount: '10%', distance: '0.8 км', icon: 'restaurant-outline' },
  { name: 'FastCharge', category: 'EV зарядка', discount: '5%', distance: '1.2 км', icon: 'flash-outline' },
  { name: 'City Market', category: 'Покупки', discount: '3%', distance: '1.6 км', icon: 'bag-handle-outline' },
];

const transactions = [
  ['Green Kitchen','− 7 000 ֏','Сегодня, 13:42','restaurant-outline'],
  ['Начисление TuTak','+ 280 ֏','Сегодня, 13:42','sparkles-outline'],
  ['FastCharge','− 2 400 ֏','Вчера, 18:10','flash-outline'],
];

function IconCircle({name, color=C.text, bg=C.soft, size=20}) {
  return <View style={[s.iconCircle,{backgroundColor:bg}]}><Ionicons name={name} size={size} color={color}/></View>;
}

function SectionTitle({children, action}) {
  return <View style={s.sectionHead}><Text style={s.sectionTitle}>{children}</Text>{action ? <Text style={s.sectionAction}>{action}</Text>:null}</View>;
}

function Home({setTab}) {
  return <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
    <View style={s.topRow}>
      <View><Text style={s.eyebrow}>Добро пожаловать</Text><Text style={s.h1}>TuTak</Text></View>
      <TouchableOpacity style={s.avatar}><Ionicons name="notifications-outline" size={22} color={C.text}/></TouchableOpacity>
    </View>

    <View style={s.balanceCard}>
      <Text style={s.balanceLabel}>Доступная скидка</Text>
      <Text style={s.balance}>12 500 ֏</Text>
      <View style={s.balanceMeta}><View><Text style={s.metaLabel}>Deferred</Text><Text style={s.metaValue}>1 850 ֏</Text></View><View><Text style={s.metaLabel}>До разблокировки</Text><Text style={s.metaValue}>18 000 ֏</Text></View></View>
      <TouchableOpacity style={s.primary} onPress={()=>setTab('pay')}><Ionicons name="scan" size={21} color="#0A2A16"/><Text style={s.primaryText}>Сделать покупку</Text></TouchableOpacity>
    </View>

    <View style={s.quickRow}>
      <TouchableOpacity style={s.quick} onPress={()=>setTab('map')}><IconCircle name="map-outline" color={C.blue} bg="#E9F8FF"/><Text style={s.quickText}>Карта</Text></TouchableOpacity>
      <TouchableOpacity style={s.quick}><IconCircle name="people-outline" color="#7C5CFC" bg="#F2EEFF"/><Text style={s.quickText}>Referral</Text></TouchableOpacity>
      <TouchableOpacity style={s.quick}><IconCircle name="flash-outline" color={C.green} bg="#E9FFF2"/><Text style={s.quickText}>EV</Text></TouchableOpacity>
    </View>

    <SectionTitle action="Смотреть все">Рядом с вами</SectionTitle>
    {partners.map((p,i)=><TouchableOpacity key={p.name} style={s.partnerCard}><IconCircle name={p.icon} color={i===1?C.blue:C.brand}/><View style={{flex:1}}><Text style={s.partnerName}>{p.name}</Text><Text style={s.partnerSub}>{p.category} · {p.distance}</Text></View><View style={s.discount}><Text style={s.discountText}>{p.discount}</Text></View><Ionicons name="chevron-forward" size={18} color={C.muted}/></TouchableOpacity>)}

    <SectionTitle action="История">Последние операции</SectionTitle>
    <View style={s.card}>{transactions.map((t,i)=><View key={i} style={[s.tx,i<transactions.length-1&&s.rowBorder]}><IconCircle name={t[3]} size={18}/><View style={{flex:1}}><Text style={s.txTitle}>{t[0]}</Text><Text style={s.txSub}>{t[2]}</Text></View><Text style={[s.txAmount,t[1].startsWith('+')&&{color:'#05A84F'}]}>{t[1]}</Text></View>)}</View>
  </ScrollView>;
}

function MapScreen() {
  const [filter,setFilter]=useState('Все');
  return <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
    <Text style={s.h1}>Карта</Text><Text style={s.subtitle}>Партнёры и EV-станции рядом</Text>
    <View style={s.search}><Ionicons name="search" size={19} color={C.muted}/><TextInput placeholder="Поиск партнёра или места" placeholderTextColor={C.muted} style={s.searchInput}/><Ionicons name="options-outline" size={20} color={C.text}/></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8,marginBottom:16}}>{['Все','Еда','EV','Покупки','Красота'].map(x=><TouchableOpacity key={x} onPress={()=>setFilter(x)} style={[s.chip,filter===x&&s.chipActive]}><Text style={[s.chipText,filter===x&&s.chipTextActive]}>{x}</Text></TouchableOpacity>)}</ScrollView>
    <View style={s.mapMock}>
      <View style={[s.pin,{top:55,left:52}]}><Ionicons name="restaurant" size={18} color="#fff"/></View>
      <View style={[s.pin,{top:135,right:60,backgroundColor:C.blue}]}><Ionicons name="flash" size={18} color="#fff"/></View>
      <View style={[s.pin,{bottom:55,left:135,backgroundColor:C.brand}]}><Ionicons name="bag-handle" size={18} color="#fff"/></View>
      <View style={s.me}><View style={s.meDot}/></View>
      <Text style={s.mapLabel}>Ереван · Demo map</Text>
    </View>
    <SectionTitle>Ближайшие точки</SectionTitle>
    {partners.map((p,i)=><View key={p.name} style={s.locationCard}><IconCircle name={p.icon} color={i===1?C.blue:C.brand}/><View style={{flex:1}}><Text style={s.partnerName}>{p.name}</Text><Text style={s.partnerSub}>{p.distance} · {p.category}</Text></View><TouchableOpacity style={s.route}><Ionicons name="navigate" size={17} color={C.blue}/><Text style={s.routeText}>Маршрут</Text></TouchableOpacity></View>)}
  </ScrollView>;
}

function Pay() {
  const [step,setStep]=useState(1); const [gross,setGross]=useState('12000'); const [discount,setDiscount]=useState('5000');
  const pay = Math.max(0,(Number(gross)||0)-(Number(discount)||0));
  if(step===3) return <View style={s.center}><View style={s.successCircle}><Ionicons name="checkmark" size={42} color="#0A2A16"/></View><Text style={s.h1}>Покупка подтверждена</Text><Text style={s.subtitleCenter}>Green Kitchen подтвердил сумму. Операция завершена.</Text><View style={[s.card,{width:'100%',marginTop:22}]}><View style={s.summaryRow}><Text style={s.summaryLabel}>Полная сумма</Text><Text style={s.summaryValue}>{gross} ֏</Text></View><View style={s.summaryRow}><Text style={s.summaryLabel}>Скидка TuTak</Text><Text style={[s.summaryValue,{color:'#05A84F'}]}>− {discount} ֏</Text></View><View style={s.summaryRow}><Text style={s.summaryLabel}>Оплата партнёру</Text><Text style={s.summaryValue}>{pay} ֏</Text></View></View><TouchableOpacity style={[s.primary,{width:'100%',marginTop:20}]} onPress={()=>setStep(1)}><Text style={s.primaryText}>Готово</Text></TouchableOpacity></View>;
  return <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
    <Text style={s.h1}>Покупка</Text><Text style={s.subtitle}>{step===1?'Проверьте партнёра и введите сумму':'Ожидаем подтверждение партнёра'}</Text>
    <View style={s.merchant}><IconCircle name="restaurant-outline" color={C.brand}/><View><Text style={s.partnerName}>Green Kitchen</Text><Text style={s.partnerSub}>Партнёр TuTak · подтверждено</Text></View><Ionicons name="checkmark-circle" size={22} color={C.green}/></View>
    {step===1 ? <>
      <Text style={s.fieldLabel}>Полная сумма покупки</Text><View style={s.moneyField}><TextInput value={gross} onChangeText={setGross} keyboardType="number-pad" style={s.moneyInput}/><Text style={s.currency}>֏</Text></View>
      <Text style={s.fieldLabel}>Использовать скидку</Text><View style={s.moneyField}><TextInput value={discount} onChangeText={setDiscount} keyboardType="number-pad" style={s.moneyInput}/><Text style={s.currency}>֏</Text></View>
      <View style={s.payBreakdown}><View><Text style={s.metaLabel}>Вы заплатите магазину</Text><Text style={s.payBig}>{pay.toLocaleString('ru-RU')} ֏</Text></View><View style={s.availablePill}><Text style={s.availableText}>Доступно 12 500 ֏</Text></View></View>
      <TouchableOpacity style={s.primary} onPress={()=>setStep(2)}><Text style={s.primaryText}>Отправить партнёру</Text><Ionicons name="arrow-forward" size={20} color="#0A2A16"/></TouchableOpacity>
    </> : <View style={s.waitCard}><View style={s.timer}><Text style={s.timerText}>02:41</Text></View><Text style={s.waitTitle}>Подтверждение на кассе</Text><Text style={s.waitText}>Кассир видит сумму {gross} ֏ и скидку {discount} ֏. Он может только подтвердить или отклонить операцию.</Text><TouchableOpacity style={[s.primary,{marginTop:18}]} onPress={()=>setStep(3)}><Text style={s.primaryText}>Демо: подтвердить</Text></TouchableOpacity><TouchableOpacity onPress={()=>setStep(1)}><Text style={s.cancel}>Отменить</Text></TouchableOpacity></View>}
  </ScrollView>;
}

function Wallet() {
  return <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
    <Text style={s.h1}>Кошелёк</Text><Text style={s.subtitle}>Ваши скидки и история</Text>
    <View style={s.walletHero}><Text style={s.balanceLabel}>Доступно сейчас</Text><Text style={s.balance}>12 500 ֏</Text><View style={s.progressTrack}><View style={[s.progressFill,{width:'67%'}]}/></View><Text style={s.walletHint}>До следующего Deferred-разблокирования: 18 000 ֏ оборота</Text></View>
    <SectionTitle>Состав баланса</SectionTitle>
    <View style={s.card}><View style={[s.walletLine,s.rowBorder]}><IconCircle name="leaf-outline" color='#05A84F' bg='#E9FFF2'/><View style={{flex:1}}><Text style={s.txTitle}>Доступная скидка</Text><Text style={s.txSub}>Можно использовать сейчас</Text></View><Text style={s.txAmount}>12 500 ֏</Text></View><View style={s.walletLine}><IconCircle name="hourglass-outline" color={C.warning} bg='#FFF7E8'/><View style={{flex:1}}><Text style={s.txTitle}>Deferred</Text><Text style={s.txSub}>54 000 ֏ оборота · 3 месяца</Text></View><Text style={s.txAmount}>1 850 ֏</Text></View></View>
    <SectionTitle>Referral Challenge</SectionTitle><View style={s.challenge}><View style={s.challengeTop}><View><Text style={s.challengeTitle}>2 из 3 мест</Text><Text style={s.challengeSub}>Приглашённый должен набрать 10 000 ֏</Text></View><IconCircle name="people" color="#7C5CFC" bg="#F2EEFF"/></View><View style={s.progressTrack}><View style={[s.progressFill,{width:'74%',backgroundColor:'#7C5CFC'}]}/></View><Text style={s.challengeFoot}>7 400 / 10 000 ֏ · награда 1 000 + 1 000 ֏</Text></View>
    <SectionTitle>История</SectionTitle><View style={s.card}>{transactions.map((t,i)=><View key={i} style={[s.tx,i<transactions.length-1&&s.rowBorder]}><IconCircle name={t[3]} size={18}/><View style={{flex:1}}><Text style={s.txTitle}>{t[0]}</Text><Text style={s.txSub}>{t[2]}</Text></View><Text style={[s.txAmount,t[1].startsWith('+')&&{color:'#05A84F'}]}>{t[1]}</Text></View>)}</View>
  </ScrollView>;
}

function Profile() {
  const rows=[['person-outline','Личные данные'],['car-outline','Мои автомобили'],['notifications-outline','Уведомления'],['language-outline','Язык'],['shield-checkmark-outline','Безопасность'],['help-circle-outline','Поддержка']];
  return <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}><Text style={s.h1}>Профиль</Text><View style={s.profileHead}><View style={s.bigAvatar}><Text style={s.bigAvatarText}>A</Text></View><View><Text style={s.profileName}>Арман</Text><Text style={s.partnerSub}>+374 00 000000</Text></View></View><View style={s.card}>{rows.map((r,i)=><TouchableOpacity key={r[1]} style={[s.profileRow,i<rows.length-1&&s.rowBorder]}><Ionicons name={r[0]} size={21} color={C.brand}/><Text style={s.profileRowText}>{r[1]}</Text><Ionicons name="chevron-forward" size={18} color={C.muted}/></TouchableOpacity>)}</View><View style={s.marketReady}><IconCircle name="storefront-outline" color={C.blue} bg="#E9F8FF"/><View style={{flex:1}}><Text style={s.txTitle}>Marketplace-ready</Text><Text style={s.txSub}>Страницы партнёров уже спроектированы как будущие storefronts. Каталог пока отключён в MVP.</Text></View></View><Text style={s.demoNote}>TuTak Demo Next · локальные демонстрационные данные · без реальных денег</Text></ScrollView>;
}

export default function App(){ const [tab,setTab]=useState('home'); const screen=useMemo(()=>({home:<Home setTab={setTab}/>,map:<MapScreen/>,pay:<Pay/>,wallet:<Wallet/>,profile:<Profile/>})[tab],[tab]); return <SafeAreaView style={s.safe}><StatusBar style="dark"/><View style={s.app}>{screen}<View style={s.nav}>{tabs.map(([id,label,icon])=>{const active=tab===id;const central=id==='pay';return <TouchableOpacity key={id} onPress={()=>setTab(id)} style={[s.navItem,central&&s.navCenter]}><View style={[central&&s.navCenterBubble,active&&central&&{backgroundColor:C.green}]}><Ionicons name={active?icon.replace('-outline',''):icon} size={central?25:22} color={active?(central?'#0A2A16':C.text):C.muted}/></View>{!central&&<Text style={[s.navText,active&&s.navTextActive]}>{label}</Text>}</TouchableOpacity>})}</View></View></SafeAreaView> }

const s=StyleSheet.create({
  safe:{flex:1,backgroundColor:C.bg},app:{flex:1,backgroundColor:C.bg},scroll:{padding:20,paddingBottom:110},
  topRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:18},eyebrow:{fontSize:13,color:C.muted,fontWeight:'600'},h1:{fontSize:30,lineHeight:36,fontWeight:'800',color:C.text,letterSpacing:-.7},subtitle:{fontSize:15,color:C.muted,marginTop:4,marginBottom:20},subtitleCenter:{fontSize:15,color:C.muted,textAlign:'center',marginTop:8,maxWidth:300},avatar:{width:44,height:44,borderRadius:16,backgroundColor:C.surface,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:C.border},
  balanceCard:{backgroundColor:C.surface,borderRadius:24,padding:20,borderWidth:1,borderColor:C.border,marginBottom:14},balanceLabel:{fontSize:13,color:C.muted,fontWeight:'600'},balance:{fontSize:37,fontWeight:'800',color:C.text,letterSpacing:-1,marginTop:3},balanceMeta:{flexDirection:'row',gap:42,marginTop:20,marginBottom:18},metaLabel:{fontSize:12,color:C.muted},metaValue:{fontSize:15,color:C.text,fontWeight:'700',marginTop:2},
  primary:{height:54,borderRadius:16,backgroundColor:C.green,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:9},primaryText:{fontSize:16,fontWeight:'800',color:'#0A2A16'},quickRow:{flexDirection:'row',gap:10,marginBottom:22},quick:{flex:1,backgroundColor:C.surface,borderRadius:18,padding:14,borderWidth:1,borderColor:C.border,alignItems:'center',gap:8},quickText:{fontSize:13,fontWeight:'700',color:C.text},iconCircle:{width:40,height:40,borderRadius:14,alignItems:'center',justifyContent:'center'},
  sectionHead:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:12,marginBottom:10},sectionTitle:{fontSize:19,fontWeight:'800',color:C.text},sectionAction:{fontSize:13,color:C.blue,fontWeight:'700'},partnerCard:{flexDirection:'row',alignItems:'center',gap:12,backgroundColor:C.surface,borderRadius:18,padding:14,borderWidth:1,borderColor:C.border,marginBottom:9},partnerName:{fontSize:15,fontWeight:'800',color:C.text},partnerSub:{fontSize:12,color:C.muted,marginTop:3},discount:{backgroundColor:'#E9FFF2',paddingHorizontal:10,paddingVertical:6,borderRadius:10},discountText:{fontSize:13,fontWeight:'800',color:'#058A45'},card:{backgroundColor:C.surface,borderRadius:20,paddingHorizontal:14,borderWidth:1,borderColor:C.border},tx:{minHeight:67,flexDirection:'row',alignItems:'center',gap:11},rowBorder:{borderBottomWidth:1,borderBottomColor:C.border},txTitle:{fontSize:14,fontWeight:'700',color:C.text},txSub:{fontSize:12,color:C.muted,marginTop:3},txAmount:{fontSize:14,fontWeight:'800',color:C.text},
  search:{height:52,borderRadius:16,backgroundColor:C.surface,borderWidth:1,borderColor:C.border,flexDirection:'row',alignItems:'center',paddingHorizontal:15,gap:9,marginBottom:12},searchInput:{flex:1,fontSize:14,color:C.text},chip:{paddingHorizontal:14,paddingVertical:9,borderRadius:12,backgroundColor:C.surface,borderWidth:1,borderColor:C.border},chipActive:{backgroundColor:C.text,borderColor:C.text},chipText:{fontSize:13,fontWeight:'700',color:C.muted},chipTextActive:{color:'#fff'},mapMock:{height:310,borderRadius:24,backgroundColor:'#E9EEF3',overflow:'hidden',position:'relative',marginBottom:10,borderWidth:1,borderColor:C.border},pin:{position:'absolute',width:42,height:42,borderRadius:15,backgroundColor:'#222',alignItems:'center',justifyContent:'center',borderWidth:3,borderColor:'#fff'},me:{position:'absolute',top:150,left:'48%',width:30,height:30,borderRadius:20,backgroundColor:'#BDEBFF',alignItems:'center',justifyContent:'center'},meDot:{width:12,height:12,borderRadius:8,backgroundColor:C.blue,borderWidth:2,borderColor:'#fff'},mapLabel:{position:'absolute',left:14,bottom:12,fontSize:11,color:C.muted,fontWeight:'700'},locationCard:{flexDirection:'row',alignItems:'center',gap:11,backgroundColor:C.surface,borderRadius:18,padding:13,borderWidth:1,borderColor:C.border,marginBottom:9},route:{flexDirection:'row',alignItems:'center',gap:5},routeText:{fontSize:12,color:C.blue,fontWeight:'700'},
  merchant:{flexDirection:'row',alignItems:'center',gap:12,backgroundColor:C.surface,borderWidth:1,borderColor:C.border,borderRadius:18,padding:14,marginBottom:22},fieldLabel:{fontSize:13,fontWeight:'700',color:C.muted,marginBottom:7},moneyField:{height:72,backgroundColor:C.surface,borderWidth:1,borderColor:C.border,borderRadius:18,flexDirection:'row',alignItems:'center',paddingHorizontal:17,marginBottom:16},moneyInput:{flex:1,fontSize:29,fontWeight:'800',color:C.text},currency:{fontSize:25,fontWeight:'700',color:C.muted},payBreakdown:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:20},payBig:{fontSize:25,fontWeight:'800',color:C.text,marginTop:2},availablePill:{backgroundColor:'#E9FFF2',borderRadius:12,paddingHorizontal:10,paddingVertical:7},availableText:{fontSize:11,fontWeight:'700',color:'#058A45'},waitCard:{backgroundColor:C.surface,borderRadius:24,borderWidth:1,borderColor:C.border,padding:24,alignItems:'center'},timer:{backgroundColor:C.soft,paddingHorizontal:16,paddingVertical:8,borderRadius:12},timerText:{fontSize:20,fontWeight:'800',color:C.text},waitTitle:{fontSize:22,fontWeight:'800',color:C.text,marginTop:20},waitText:{fontSize:14,color:C.muted,textAlign:'center',lineHeight:21,marginTop:8},cancel:{fontSize:14,fontWeight:'700',color:C.red,marginTop:18},center:{flex:1,alignItems:'center',justifyContent:'center',padding:24,backgroundColor:C.bg},successCircle:{width:82,height:82,borderRadius:30,backgroundColor:C.green,alignItems:'center',justifyContent:'center',marginBottom:20},summaryRow:{flexDirection:'row',justifyContent:'space-between',paddingVertical:11},summaryLabel:{fontSize:13,color:C.muted},summaryValue:{fontSize:14,fontWeight:'800',color:C.text},
  walletHero:{backgroundColor:C.surface,borderRadius:24,padding:20,borderWidth:1,borderColor:C.border,marginTop:18},progressTrack:{height:8,borderRadius:8,backgroundColor:C.soft,overflow:'hidden',marginTop:18},progressFill:{height:'100%',backgroundColor:C.green,borderRadius:8},walletHint:{fontSize:12,color:C.muted,marginTop:9,lineHeight:18},walletLine:{minHeight:76,flexDirection:'row',alignItems:'center',gap:12},challenge:{backgroundColor:C.surface,borderRadius:20,padding:16,borderWidth:1,borderColor:C.border},challengeTop:{flexDirection:'row',justifyContent:'space-between'},challengeTitle:{fontSize:17,fontWeight:'800',color:C.text},challengeSub:{fontSize:12,color:C.muted,marginTop:3,maxWidth:250},challengeFoot:{fontSize:12,color:C.muted,marginTop:8},
  profileHead:{flexDirection:'row',alignItems:'center',gap:14,marginTop:18,marginBottom:18},bigAvatar:{width:64,height:64,borderRadius:22,backgroundColor:C.text,alignItems:'center',justifyContent:'center'},bigAvatarText:{fontSize:26,fontWeight:'800',color:'#fff'},profileName:{fontSize:20,fontWeight:'800',color:C.text},profileRow:{height:59,flexDirection:'row',alignItems:'center',gap:12},profileRowText:{flex:1,fontSize:14,fontWeight:'700',color:C.text},marketReady:{flexDirection:'row',gap:12,marginTop:16,backgroundColor:'#F0FAFF',borderRadius:18,padding:14,borderWidth:1,borderColor:'#D9F1FF'},demoNote:{fontSize:11,color:C.muted,textAlign:'center',marginTop:24,lineHeight:16},
  nav:{position:'absolute',left:12,right:12,bottom:12,height:76,borderRadius:24,backgroundColor:'rgba(255,255,255,0.98)',borderWidth:1,borderColor:C.border,flexDirection:'row',alignItems:'center',justifyContent:'space-around',paddingHorizontal:4},navItem:{width:62,alignItems:'center',justifyContent:'center',gap:4},navText:{fontSize:10,fontWeight:'700',color:C.muted},navTextActive:{color:C.text},navCenter:{marginTop:-24},navCenterBubble:{width:58,height:58,borderRadius:20,backgroundColor:C.soft,alignItems:'center',justifyContent:'center',borderWidth:5,borderColor:C.bg}
});
