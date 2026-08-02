import type { ParamListBase } from '@react-navigation/native';

export type RootStackParamList = {
  Home: undefined;
  Main: undefined;
  Settings: undefined;
} & ParamListBase;

export type MainTabParamList = {
  Chat: undefined;
  Settings: undefined;
} & ParamListBase;