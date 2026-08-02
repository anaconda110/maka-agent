import type { ParamListBase } from '@react-navigation/native';

export type RootStackParamList = {
  Home: undefined;
  Settings: undefined;
} & ParamListBase;

export type MainTabParamList = {
  Chat: undefined;
  Settings: undefined;
} & ParamListBase;

declare module '@react-navigation/native' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface NavigationState extends RootStackParamList {}
}